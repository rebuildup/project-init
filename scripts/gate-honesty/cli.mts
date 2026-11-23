#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkClaimHonesty,
  checkWorkflowHonesty,
  checkWorkflowsDirectory,
  parseClaimVerificationRecord,
  parseCssMirrorInput,
  parseSchemaIndexInput,
  verifyCssMirror,
  verifySchemaIndexes,
  verifyTapOutput,
  verifyVitestJsonOutput,
} from "./index.mts";

function readSource(fileOrStdin: string): string {
  if (fileOrStdin === "-" || fileOrStdin === "stdin") {
    return readFileSync(0, "utf8");
  }
  return readFileSync(resolve(fileOrStdin), "utf8");
}

function parseFloorOption(raw: string): number {
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`Invalid --floor value '${raw}': expected integer >= 1`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid --floor value '${raw}': expected integer >= 1`);
  }
  return value;
}

function usage(): string {
  return [
    "usage:",
    "  cli.mts workflow <file>",
    "  cli.mts workflow --workflows-dir <dir>",
    "  cli.mts --workflows-dir <dir>",
    "  cli.mts claim <file>",
    "  cli.mts verify-tap <file|stdin|-> [--floor N] [--partition NAME]",
    "  cli.mts --verify-tap <file|stdin|-> [--floor N] [--partition NAME]",
    "  cli.mts verify-vitest-json <file|stdin|-> [--floor N] [--partition NAME]",
    "  cli.mts --verify-vitest-json <file|stdin|-> [--floor N] [--partition NAME]",
    "  cli.mts run-and-verify [--floor N] [--partition NAME] [--format tap|vitest-json] -- <cmd...>",
    "  cli.mts --run-and-verify [--floor N] [--partition NAME] [--format tap|vitest-json] -- <cmd...>",
    "  cli.mts verify-css-mirror <spec.json>",
    "  cli.mts verify-schema-index <spec.json>",
  ].join("\n");
}

function parseVerifyFlags(args: readonly string[]): {
  readonly target: string;
  readonly floor: number;
  readonly partition?: string;
} {
  let target: string | undefined;
  let floor = 1;
  let partition: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === "--floor") {
      const next = args[i + 1];
      if (next === undefined) throw new Error("Missing value for --floor");
      floor = parseFloorOption(next);
      i += 1;
    } else if (arg === "--partition") {
      const next = args[i + 1];
      if (next === undefined || next.trim() === "") {
        throw new Error("Missing value for --partition");
      }
      partition = next;
      i += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (target === undefined) {
      target = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }

  if (target === undefined) {
    throw new Error("Missing input file path (use '-' or 'stdin' to read from standard input)");
  }

  return {
    target,
    floor,
    ...(partition !== undefined ? { partition } : {}),
  };
}

function runAndVerify(args: readonly string[]): number {
  const sepIndex = args.indexOf("--");
  if (sepIndex === -1 || sepIndex === args.length - 1) {
    console.error("run-and-verify requires `-- <cmd...>`");
    return 2;
  }

  const flagArgs = args.slice(0, sepIndex);
  const cmdArgs = args.slice(sepIndex + 1);
  let floor = 1;
  let partition = "command";
  let format: "tap" | "vitest-json" = "tap";

  for (let i = 0; i < flagArgs.length; i += 1) {
    const arg = flagArgs[i] ?? "";
    if (arg === "--floor") {
      const next = flagArgs[i + 1];
      if (next === undefined) {
        console.error("Missing value for --floor");
        return 2;
      }
      floor = parseFloorOption(next);
      i += 1;
    } else if (arg === "--partition") {
      const next = flagArgs[i + 1];
      if (next === undefined || next.trim() === "") {
        console.error("Missing value for --partition");
        return 2;
      }
      partition = next;
      i += 1;
    } else if (arg === "--format") {
      const next = flagArgs[i + 1];
      if (next !== "tap" && next !== "vitest-json") {
        console.error(`Invalid --format '${String(next)}': expected 'tap' or 'vitest-json'`);
        return 2;
      }
      format = next;
      i += 1;
    } else {
      console.error(`Unknown option: ${arg}`);
      return 2;
    }
  }

  const executable = cmdArgs[0];
  if (!executable) {
    console.error("run-and-verify requires a command after `--`");
    return 2;
  }

  const child = spawnSync(executable, cmdArgs.slice(1), {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (child.error) {
    console.error(`Failed to execute command '${executable}': ${child.error.message}`);
    return 2;
  }

  if (child.stderr) {
    process.stderr.write(child.stderr);
  }

  const exitCode = child.status ?? 1;
  const output = child.stdout ?? "";
  const result =
    format === "tap"
      ? verifyTapOutput(output, { partition, exitCode, minPassedRequired: floor })
      : verifyVitestJsonOutput(output, { partition, exitCode, minPassedRequired: floor });

  const status = result.verdict === "VERIFIED" ? "PASS" : "FAIL";
  if (status === "FAIL" && output.trim().length > 0) {
    process.stderr.write(`${output}\n`);
  }
  console.log(
    JSON.stringify(
      {
        status,
        verdict: result.verdict,
        partition,
        exitCode,
        floor,
        findings: result.findings,
      },
      null,
      2,
    ),
  );
  return status === "PASS" ? 0 : 1;
}

export function main(argv: readonly string[]): number {
  const mode = argv[0];
  if (!mode || mode === "--help" || mode === "-h") {
    console.error(usage());
    return mode ? 0 : 2;
  }

  try {
    if (mode === "--workflows-dir") {
      const dir = argv[1];
      if (!dir) {
        console.error("Missing directory after --workflows-dir");
        return 2;
      }
      const res = checkWorkflowsDirectory(dir);
      console.log(
        JSON.stringify(
          {
            status: res.findings.length === 0 ? "PASS" : "FAIL",
            filesChecked: res.filesChecked,
            findings: res.findings,
          },
          null,
          2,
        ),
      );
      return res.findings.length === 0 ? 0 : 1;
    }

    if (mode === "workflow") {
      const arg1 = argv[1];
      if (!arg1) {
        console.error(usage());
        return 2;
      }
      if (arg1 === "--workflows-dir") {
        const dir = argv[2];
        if (!dir) {
          console.error("Missing directory after --workflows-dir");
          return 2;
        }
        const res = checkWorkflowsDirectory(dir);
        console.log(
          JSON.stringify(
            {
              status: res.findings.length === 0 ? "PASS" : "FAIL",
              filesChecked: res.filesChecked,
              findings: res.findings,
            },
            null,
            2,
          ),
        );
        return res.findings.length === 0 ? 0 : 1;
      }
      const content = readFileSync(resolve(arg1), "utf8");
      const findings = checkWorkflowHonesty(content, arg1);
      console.log(
        JSON.stringify({ status: findings.length === 0 ? "PASS" : "FAIL", findings }, null, 2),
      );
      return findings.length === 0 ? 0 : 1;
    }

    if (mode === "claim") {
      const filePath = argv[1];
      if (!filePath) {
        console.error(usage());
        return 2;
      }
      const content = readSource(filePath);
      const raw: unknown = JSON.parse(content);
      const record = parseClaimVerificationRecord(raw);
      const findings = checkClaimHonesty(record);
      console.log(
        JSON.stringify({ status: findings.length === 0 ? "PASS" : "FAIL", findings }, null, 2),
      );
      return findings.length === 0 ? 0 : 1;
    }

    if (mode === "verify-tap" || mode === "--verify-tap") {
      const opts = parseVerifyFlags(argv.slice(1));
      const content = readSource(opts.target);
      const res = verifyTapOutput(content, {
        minPassedRequired: opts.floor,
        ...(opts.partition !== undefined ? { partition: opts.partition } : {}),
      });
      const status = res.verdict === "VERIFIED" ? "PASS" : "FAIL";
      console.log(
        JSON.stringify({ status, verdict: res.verdict, findings: res.findings }, null, 2),
      );
      return status === "PASS" ? 0 : 1;
    }

    if (mode === "verify-vitest-json" || mode === "--verify-vitest-json") {
      const opts = parseVerifyFlags(argv.slice(1));
      const content = readSource(opts.target);
      const res = verifyVitestJsonOutput(content, {
        minPassedRequired: opts.floor,
        ...(opts.partition !== undefined ? { partition: opts.partition } : {}),
      });
      const status = res.verdict === "VERIFIED" ? "PASS" : "FAIL";
      console.log(
        JSON.stringify({ status, verdict: res.verdict, findings: res.findings }, null, 2),
      );
      return status === "PASS" ? 0 : 1;
    }

    if (mode === "run-and-verify" || mode === "--run-and-verify") {
      return runAndVerify(argv.slice(1));
    }

    if (mode === "verify-css-mirror") {
      const filePath = argv[1];
      if (!filePath) {
        console.error(usage());
        return 2;
      }
      const raw: unknown = JSON.parse(readSource(filePath));
      const spec = parseCssMirrorInput(raw);
      const findings = verifyCssMirror(spec);
      console.log(
        JSON.stringify({ status: findings.length === 0 ? "PASS" : "FAIL", findings }, null, 2),
      );
      return findings.length === 0 ? 0 : 1;
    }

    if (mode === "verify-schema-index") {
      const filePath = argv[1];
      if (!filePath) {
        console.error(usage());
        return 2;
      }
      const raw: unknown = JSON.parse(readSource(filePath));
      const spec = parseSchemaIndexInput(raw);
      const findings = verifySchemaIndexes(spec);
      console.log(
        JSON.stringify({ status: findings.length === 0 ? "PASS" : "FAIL", findings }, null, 2),
      );
      return findings.length === 0 ? 0 : 1;
    }

    console.error(`unknown mode: ${mode}\n${usage()}`);
    return 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
