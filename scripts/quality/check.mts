#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { fromMarkdown } from "mdast-util-from-markdown";
import { parseDocument } from "yaml";
import { parse as parseToml } from "smol-toml";
import { spawnSync } from "node:child_process";

class ToolExecutionError extends Error {}

type Finding = { code: string; path: string; detail: string };
const ignored = new Set([
  ".git",
  "node_modules",
  ".reference",
  ".tmp",
  ".DS_Store",
]);
export function inspect(root: string): Finding[] {
  root = resolve(root);
  const findings: Finding[] = [],
    files: string[] = [];
  const report = (code: string, path: string, detail: string) =>
    findings.push({ code, path, detail });
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        report(
          "UNCLASSIFIED_SYMLINK",
          relative(root, path),
          "materialize or explicitly classify before analysis",
        );
        continue;
      }
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  walk(root);
  const classified = new Set([
    ".mts",
    ".cts",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".md",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".sh",
    ".tla",
    ".cfg",
    ".tsv",
    ".txt",
    ".log",
  ]);
  const special = new Set([
    "LICENSE",
    ".gitignore",
    ".gitattributes",
    "bun.lock",
  ]);
  for (const path of files) {
    const local = relative(root, path),
      extension = extname(path),
      text = readFileSync(path, "utf8");
    if (!classified.has(extension) && !special.has(basename(path)))
      report(
        "UNCLASSIFIED_FILE",
        local,
        "add a justified analysis classification",
      );
    try {
      if (extension === ".json") {
        if (/^tsconfig(?:\.[^.]+)*\.json$/.test(basename(path))) {
          const config = ts.readConfigFile(path, ts.sys.readFile);
          if (config.error)
            throw Error(
              ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
            );
        } else JSON.parse(text);
      }
      if (extension === ".yaml" || extension === ".yml") {
        const doc = parseDocument(text);
        if (doc.errors.length)
          throw Error(doc.errors.map((x) => x.message).join("; "));
      }
      if (extension === ".toml") parseToml(text);
      if (extension === ".sh") {
        const result = spawnSync("bash", ["-n", path], {
          encoding: "utf8",
          timeout: 10000,
          killSignal: "SIGKILL",
        });
        if (result.error || result.signal || result.status === null)
          throw new ToolExecutionError(
            result.error?.message ?? "bash terminated: " + result.signal,
          );
        if (result.status !== 0) throw Error(result.stderr);
        const lint = spawnSync("shellcheck", ["--shell=bash", path], {
          encoding: "utf8",
          timeout: 10000,
          killSignal: "SIGKILL",
        });
        if (
          lint.error ||
          lint.signal ||
          lint.status === null ||
          lint.status > 1
        )
          throw new ToolExecutionError(
            lint.error?.message ??
              "shellcheck failed: " + lint.status + " " + lint.signal,
          );
        if (lint.status !== 0) throw Error(lint.stdout + lint.stderr);
      }
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      report("INVALID_CONFIGURATION", local, String(error));
    }
  }
  const configPath = join(root, "tsconfig.json");
  const sources = files.filter((path) => /\.[cm]?[jt]sx?$/.test(path));
  if (sources.length) {
    if (!existsSync(configPath))
      report(
        "MISSING_ANALYSIS_CONFIG",
        "tsconfig.json",
        "source files require an analysis configuration",
      );
    else {
      const read = ts.readConfigFile(configPath, ts.sys.readFile);
      const config = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
      for (const error of [read.error, ...config.errors].filter(
        (x): x is ts.Diagnostic => !!x,
      )) {
        report(
          "INVALID_ANALYSIS_CONFIG",
          "tsconfig.json",
          ts.flattenDiagnosticMessageText(error.messageText, "\n"),
        );
      }
      const covered = new Set(config.fileNames.map((path) => resolve(path)));
      for (const path of sources)
        if (!covered.has(path))
          report(
            "UNANALYZED_SOURCE",
            relative(root, path),
            "not included in TypeScript analysis",
          );
      if (
        config.options.noCheck ||
        !config.options.strict ||
        [
          "strictNullChecks",
          "strictFunctionTypes",
          "strictBindCallApply",
          "strictPropertyInitialization",
          "strictBuiltinIteratorReturn",
          "noImplicitAny",
          "noImplicitThis",
          "alwaysStrict",
          "useUnknownInCatchVariables",
        ].some((key) => config.options[key] === false)
      )
        report(
          "WEAKENED_ANALYSIS",
          "tsconfig.json",
          "strict analysis is required; noCheck is forbidden",
        );
      if (
        sources.some((path) => /\.[cm]?jsx?$/.test(path)) &&
        !config.options.checkJs
      )
        report(
          "WEAKENED_ANALYSIS",
          "tsconfig.json",
          "JavaScript sources require checkJs",
        );
    }
  }
  for (const path of sources) {
    const text = readFileSync(path, "utf8");
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const comments = new Map<number, ts.CommentRange>();
    function visit(node: ts.Node): void {
      for (const range of [
        ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
      ])
        comments.set(range.pos, range);
      for (const child of node.getChildren(source)) visit(child);
    }
    visit(source);
    for (const range of comments.values()) {
      if (
        /@ts-(?:nocheck|ignore|expect-error)\b/.test(
          text.slice(range.pos, range.end),
        )
      ) {
        report(
          "ANALYSIS_SUPPRESSION",
          relative(root, path),
          "source-level TypeScript suppression requires contract revision",
        );
      }
    }
  }
  for (const path of files.filter((path) => path.endsWith(".md"))) {
    if (
      relative(root, path).replaceAll("\\", "/") ===
      "evals/skills-cli-materialization/fixtures/negative-missing-reference/.agents/skills/engineering-decisions/SKILL.md"
    )
      continue;
    if (
      basename(path) === "SKILL.md" &&
      !relative(root, path)
        .replaceAll("\\", "/")
        .startsWith("evals/skills-cli-materialization/fixtures/")
    ) {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(
        readFileSync(path, "utf8"),
      );
      if (frontmatter) {
        const document = parseDocument(frontmatter[1]);
        if (document.errors.length)
          report(
            "INVALID_SKILL_METADATA",
            relative(root, path),
            document.errors.map((error) => error.message).join("; "),
          );
        else {
          const value = document.toJSON();
          const dependencies = value?.metadata?.["requires-skills"];
          if (dependencies !== undefined) {
            if (
              typeof dependencies !== "string" ||
              !/^[a-z0-9-]+(?: [a-z0-9-]+)*$/.test(dependencies)
            )
              report(
                "INVALID_SKILL_METADATA",
                relative(root, path),
                "requires-skills must contain space-separated skill names",
              );
            else
              for (const dependency of dependencies.split(" ")) {
                if (
                  !existsSync(
                    join(dirname(dirname(path)), dependency, "SKILL.md"),
                  )
                )
                  report(
                    "MISSING_SKILL_DEPENDENCY",
                    relative(root, path),
                    dependency,
                  );
              }
          }
        }
      }
    }
    type Node = { type: string; url?: string; children?: Node[] };
    function visit(node: Node) {
      if (node.url && ["link", "image", "definition"].includes(node.type)) {
        const href = node.url;
        if (!/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) {
          try {
            const target = decodeURIComponent(href.split(/[?#]/)[0]);
            if (target && !existsSync(resolve(dirname(path), target)))
              report("BROKEN_REFERENCE", relative(root, path), href);
          } catch {
            report("BROKEN_REFERENCE", relative(root, path), href);
          }
        }
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(fromMarkdown(readFileSync(path, "utf8")));
  }
  return findings;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const findings = inspect(process.argv[2] ?? ".");
    for (const finding of findings) console.error(JSON.stringify(finding));
    for (const code of new Set(findings.map((x) => x.code)))
      console.error(code);
    console.log(
      JSON.stringify({
        status: findings.length ? "FAIL" : "PASS",
        checks: [
          "file-classification",
          "configuration-syntax",
          "typescript-scope",
          "typescript-suppressions",
          "local-markdown-links",
        ],
        findings: findings.length,
      }),
    );
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    console.error(String(error));
    process.exitCode = 2;
  }
}
