import type { CssMirrorInput, GateFinding, SchemaIndexInput } from "./types.mts";

interface ParsedCssRule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, readonly string[]>;
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseDeclarations(block: string): Map<string, string[]> {
  const declarations = new Map<string, string[]>();
  for (const part of block.split(";")) {
    const colonIdx = part.indexOf(":");
    if (colonIdx <= 0) continue;
    const prop = part.slice(0, colonIdx).trim().toLowerCase();
    const val = part.slice(colonIdx + 1).trim();
    if (!prop || !val) continue;
    const existing = declarations.get(prop);
    if (existing) existing.push(val);
    else declarations.set(prop, [val]);
  }
  return declarations;
}

function parseCssRules(cssText: string): ParsedCssRule[] {
  const cleaned = stripCssComments(cssText);
  const rules: ParsedCssRule[] = [];

  function walk(text: string): void {
    let i = 0;
    while (i < text.length) {
      const openIdx = text.indexOf("{", i);
      if (openIdx === -1) break;
      const header = text.slice(i, openIdx).trim();

      let depth = 1;
      let j = openIdx + 1;
      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
        j += 1;
      }
      if (depth !== 0) break;

      const body = text.slice(openIdx + 1, j - 1);
      i = j;

      if (!header) continue;
      if (header.startsWith("@")) {
        // Recurse into @media, @supports, @layer, etc.
        if (body.includes("{")) walk(body);
        continue;
      }

      const selectors = header
        .split(",")
        .map((s) => s.trim().replace(/\s+/g, " "))
        .filter((s) => s.length > 0);
      if (selectors.length > 0) {
        rules.push({ selectors, declarations: parseDeclarations(body) });
      }
    }
  }

  walk(cleaned);
  return rules;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectorMatches(ruleSelector: string, expectedSelector: string): boolean {
  const normRule = ruleSelector.trim().replace(/\s+/g, " ");
  const normExpected = expectedSelector.trim().replace(/\s+/g, " ");
  if (normRule === normExpected) return true;
  // Allow pseudo-class/combinator usage of the exact selector token (e.g. `.foo:hover` or `.parent > .foo`),
  // while rejecting prefix collisions like `.foo-bar` for `.foo`.
  const pattern = new RegExp(
    `(?:^|[\\s>+~,(])${escapeRegExp(normExpected)}(?:$|[\\s>+~,:.[\\]()])`,
  );
  return pattern.test(normRule);
}

function propertyMatches(declaredProp: string, expectedProp: string): boolean {
  const normDecl = declaredProp.trim().toLowerCase();
  const normExp = expectedProp.trim().toLowerCase();
  if (normDecl === normExp) return true;
  // Allow longhand property to satisfy shorthand expectation (e.g. padding-inline satisfies padding).
  if (normDecl.startsWith(`${normExp}-`)) return true;
  return false;
}

function valueMatches(declaredVal: string, expectedVal: string): boolean {
  const normDecl = declaredVal.trim().replace(/\s+/g, " ").toLowerCase();
  const normExp = expectedVal.trim().replace(/\s+/g, " ").toLowerCase();
  if (normDecl === normExp) return true;
  const tokens = normDecl.split(" ");
  return tokens.includes(normExp);
}

/**
 * Deterministic constant/selector-vs-CSS mirror verifier (`readmark #76` class).
 * Verifies that every selector (and optional property/value) claimed to mirror a constant
 * actually exists in the target stylesheet.
 */
export function verifyCssMirror(input: CssMirrorInput): GateFinding[] {
  const findings: GateFinding[] = [];
  if (!input.subject.trim()) {
    findings.push({
      code: "INVALID_VERIFIER_SPEC",
      subject: "css-mirror",
      detail: "cssMirror check subject must be non-empty",
    });
    return findings;
  }

  if (input.expectations.length === 0) {
    findings.push({
      code: "INVALID_VERIFIER_SPEC",
      subject: input.subject,
      detail: "cssMirror check must declare at least one expectation",
    });
    return findings;
  }

  const rules = parseCssRules(input.cssText);

  for (const exp of input.expectations) {
    const expSubject = `${input.subject}:${exp.constantName}`;
    if (!exp.constantName.trim() || exp.selectors.length === 0) {
      findings.push({
        code: "INVALID_VERIFIER_SPEC",
        subject: expSubject,
        detail: "cssMirror expectation requires non-empty constantName and at least one selector",
      });
      continue;
    }

    if (input.sourceCode !== undefined) {
      const constPattern = new RegExp(`\\b${escapeRegExp(exp.constantName)}\\b`);
      if (!constPattern.test(input.sourceCode)) {
        findings.push({
          code: "UNVERIFIED_PROSE_MIRROR",
          subject: expSubject,
          detail: `declared constant '${exp.constantName}' not found in source file`,
        });
      }
    }

    const matchedRulesForAnySelector: ParsedCssRule[] = [];
    for (const selector of exp.selectors) {
      const matching = rules.filter((r) =>
        r.selectors.some((ruleSel) => selectorMatches(ruleSel, selector)),
      );
      if (matching.length === 0) {
        findings.push({
          code: "UNVERIFIED_PROSE_MIRROR",
          subject: expSubject,
          detail: `claimed mirrored CSS selector '${selector}' does not exist in target stylesheet`,
        });
      } else {
        matchedRulesForAnySelector.push(...matching);
      }
    }

    if (exp.expectedProperty && matchedRulesForAnySelector.length > 0) {
      const propValues: string[] = [];
      for (const rule of matchedRulesForAnySelector) {
        for (const [prop, vals] of rule.declarations.entries()) {
          if (propertyMatches(prop, exp.expectedProperty)) {
            propValues.push(...vals);
          }
        }
      }

      if (propValues.length === 0) {
        findings.push({
          code: "UNVERIFIED_PROSE_MIRROR",
          subject: expSubject,
          detail: `none of [${exp.selectors.join(", ")}] declares expected CSS property '${exp.expectedProperty}'`,
        });
      } else if (
        exp.expectedValue !== undefined &&
        !propValues.some((val) => valueMatches(val, exp.expectedValue!))
      ) {
        findings.push({
          code: "UNVERIFIED_PROSE_MIRROR",
          subject: expSubject,
          detail: `CSS property '${exp.expectedProperty}' on [${exp.selectors.join(", ")}] has values [${propValues.join("; ")}], which do not match claimed value '${exp.expectedValue}'`,
        });
      }
    }
  }

  return findings;
}

function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim();
  // Remove schema qualifier (e.g. public.bookmarks -> bookmarks)
  const parts = trimmed.split(".");
  const last = (parts[parts.length - 1] ?? trimmed).trim();
  return last.replace(/^["`[\]]+|["`[\]]+$/g, "").toLowerCase();
}

function parseColumnList(rawCols: string): string[] {
  return rawCols
    .split(",")
    .map((part) => {
      // Strip sort direction / NULLS ordering / collation / length spec (e.g. `col(20) DESC NULLS LAST`)
      const cleaned = part
        .trim()
        .replace(/\(\s*\d+\s*\)/g, "")
        .replace(/\b(?:ASC|DESC|NULLS\s+FIRST|NULLS\s+LAST)\b/gi, "")
        .trim();
      const firstToken = cleaned.split(/\s+/)[0] ?? "";
      return normalizeIdentifier(firstToken);
    })
    .filter((c) => c.length > 0);
}

function addIndex(
  indexMap: Map<string, string[][]>,
  table: string,
  cols: string[],
): void {
  if (!table || cols.length === 0) return;
  const existing = indexMap.get(table);
  if (existing) existing.push(cols);
  else indexMap.set(table, [cols]);
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function parseSqlIndexes(sqlDdl: string): Map<string, string[][]> {
  const indexMap = new Map<string, string[][]>();
  const cleaned = stripSqlComments(sqlDdl);

  // 1. Standalone CREATE [UNIQUE] INDEX ... ON table [USING method] (col1, col2, ...)
  const createIndexRegex =
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:["`\[]?[A-Za-z0-9_.]+["`\]]?\s+)?ON\s+(?:ONLY\s+)?(["`\[]?[A-Za-z0-9_.]+["`\]]?)\s*(?:USING\s+[A-Za-z0-9_]+\s*)?\(([^)]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = createIndexRegex.exec(cleaned)) !== null) {
    const table = normalizeIdentifier(match[1] ?? "");
    const cols = parseColumnList(match[2] ?? "");
    addIndex(indexMap, table, cols);
  }

  // 2. Inline CREATE TABLE constraints (PRIMARY KEY, UNIQUE, INDEX/KEY)
  const createTableRegex =
    /CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(["`\[]?[A-Za-z0-9_.]+["`\]]?)\s*\(/gi;
  while ((match = createTableRegex.exec(cleaned)) !== null) {
    const table = normalizeIdentifier(match[1] ?? "");
    const startIdx = match.index + match[0].length;
    let depth = 1;
    let j = startIdx;
    while (j < cleaned.length && depth > 0) {
      if (cleaned[j] === "(") depth += 1;
      else if (cleaned[j] === ")") depth -= 1;
      j += 1;
    }
    if (depth !== 0) continue;
    const body = cleaned.slice(startIdx, j - 1);

    // Table-level PRIMARY KEY / UNIQUE / INDEX / KEY (...)
    const tableConstraintRegex =
      /(?:CONSTRAINT\s+["`\[]?[A-Za-z0-9_]+["`\]]?\s+)?(?:PRIMARY\s+KEY|UNIQUE(?:\s+(?:INDEX|KEY))?(?:\s+["`\[]?[A-Za-z0-9_]+["`\]]?)?|(?:INDEX|KEY)\s+["`\[]?[A-Za-z0-9_]+["`\]]?)\s*\(([^)]+)\)/gi;
    let cm: RegExpExecArray | null;
    while ((cm = tableConstraintRegex.exec(body)) !== null) {
      const cols = parseColumnList(cm[1] ?? "");
      addIndex(indexMap, table, cols);
    }

    // Column-level PRIMARY KEY / UNIQUE
    for (const rawLine of body.split(",")) {
      const line = rawLine.trim();
      if (/^(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|INDEX|KEY)\b/i.test(line)) {
        continue;
      }
      if (/\b(?:PRIMARY\s+KEY|UNIQUE)\b/i.test(line)) {
        const colMatch = /^(["`\[]?[A-Za-z0-9_]+["`\]]?)\s+/.exec(line);
        if (colMatch?.[1]) {
          addIndex(indexMap, table, [normalizeIdentifier(colMatch[1])]);
        }
      }
    }
  }

  return indexMap;
}

function parseDexieIndexes(
  dexieSchema: Readonly<Record<string, string>>,
): Map<string, string[][]> {
  const indexMap = new Map<string, string[][]>();
  for (const [rawTable, spec] of Object.entries(dexieSchema)) {
    const table = normalizeIdentifier(rawTable);
    for (const rawEntry of spec.split(",")) {
      const entry = rawEntry.trim();
      if (!entry) continue;
      if (entry.startsWith("[") && entry.endsWith("]")) {
        const cols = entry
          .slice(1, -1)
          .split("+")
          .map((c) => normalizeIdentifier(c))
          .filter((c) => c.length > 0);
        addIndex(indexMap, table, cols);
      } else {
        const col = normalizeIdentifier(entry.replace(/^(?:\+\+|&|\*)/, ""));
        if (col) addIndex(indexMap, table, [col]);
      }
    }
  }
  return indexMap;
}

function indexCoversColumns(
  indexColumns: readonly string[],
  claimedColumns: readonly string[],
): boolean {
  if (claimedColumns.length === 0 || claimedColumns.length > indexColumns.length) {
    return false;
  }
  for (let i = 0; i < claimedColumns.length; i += 1) {
    if (indexColumns[i] !== claimedColumns[i]) return false;
  }
  return true;
}

/**
 * Deterministic schema-index verifier (`readmark #72` class).
 * Parses SQL DDL and/or Dexie store schemas and verifies that every claimed indexed query
 * is actually covered by a declared index (leftmost-prefix semantics).
 */
export function verifySchemaIndexes(input: SchemaIndexInput): GateFinding[] {
  const findings: GateFinding[] = [];
  if (!input.subject.trim()) {
    findings.push({
      code: "INVALID_VERIFIER_SPEC",
      subject: "schema-index",
      detail: "schemaIndex check subject must be non-empty",
    });
    return findings;
  }

  if (input.claims.length === 0) {
    findings.push({
      code: "INVALID_VERIFIER_SPEC",
      subject: input.subject,
      detail: "schemaIndex check must declare at least one query index claim",
    });
    return findings;
  }

  if (input.sqlDdl === undefined && input.dexieSchema === undefined) {
    findings.push({
      code: "INVALID_VERIFIER_SPEC",
      subject: input.subject,
      detail: "schemaIndex check requires sqlDdl and/or dexieSchema",
    });
    return findings;
  }

  const indexMap = new Map<string, string[][]>();
  if (input.sqlDdl !== undefined) {
    for (const [table, indexes] of parseSqlIndexes(input.sqlDdl).entries()) {
      for (const cols of indexes) addIndex(indexMap, table, cols);
    }
  }
  if (input.dexieSchema !== undefined) {
    for (const [table, indexes] of parseDexieIndexes(input.dexieSchema).entries()) {
      for (const cols of indexes) addIndex(indexMap, table, cols);
    }
  }

  for (const claim of input.claims) {
    const claimSubject = `${input.subject}:${claim.queryName}`;
    const table = normalizeIdentifier(claim.table);
    const claimedCols = claim.columns.map(normalizeIdentifier).filter((c) => c.length > 0);

    if (!claim.queryName.trim() || !table || claimedCols.length === 0) {
      findings.push({
        code: "INVALID_VERIFIER_SPEC",
        subject: claimSubject,
        detail: "query index claim requires non-empty queryName, table, and columns",
      });
      continue;
    }

    const available = indexMap.get(table) ?? [];
    const covered = available.some((idxCols) => indexCoversColumns(idxCols, claimedCols));
    if (!covered) {
      const declaredSummary =
        available.length === 0
          ? "none"
          : available.map((cols) => `[${cols.join("+")}]`).join(", ");
      findings.push({
        code: "FALLBACK_CONTRADICTS_CLAIM",
        subject: claimSubject,
        detail: `claimed indexed query on '${claim.table}' for [${claimedCols.join("+")}] is not covered by any declared index (declared: ${declaredSummary}); runtime would fall back to scan`,
      });
    }
  }

  return findings;
}
