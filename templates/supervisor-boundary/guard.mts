#!/usr/bin/env node
// Defense in depth for a dedicated, non-authoring Claude Code Supervisor session.
// This hook is NOT an OS/filesystem or API credential security boundary.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'ToolSearch']);
const BROKER_NAME = /^mcp__[A-Za-z0-9_-]+__(spawn_worker|observe_worker|wait_worker|cancel_worker|recover_worker|get_worker_result|admit_worker_result)$/;

export function brokerAllowlist(raw: string | undefined): Set<string> {
  if (raw === undefined || raw === '') return new Set();
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.some(item =>
    typeof item !== 'string' || !BROKER_NAME.test(item)
  ) || new Set(value).size !== value.length) {
    throw new Error('SUPERVISOR_BROKER_TOOLS must be a JSON array of unique exact MCP tool names');
  }
  return new Set(value as string[]);
}

export function isAllowed(toolName: unknown, brokerTools: ReadonlySet<string>): boolean {
  return typeof toolName === 'string' &&
    (READ_ONLY_TOOLS.has(toolName) || brokerTools.has(toolName));
}

export function guardDecision(input: unknown, brokerTools: ReadonlySet<string>): object | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input) ||
      !('tool_name' in input) || typeof input.tool_name !== 'string' ||
      !input.tool_name.trim()) {
    throw new Error('invalid PreToolUse input');
  }
  if (isAllowed(input.tool_name, brokerTools)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        'Dedicated Supervisor is non-authoring. Use a separately authorized Worker/Broker; do not edit, execute shell, or call privileged APIs here.'
    }
  };
}

async function main(): Promise<void> {
  try {
    const brokerTools = brokerAllowlist(process.env.SUPERVISOR_BROKER_TOOLS);
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (raw.length > 1024 * 1024) throw new Error('hook input exceeds limit');
    }
    const decision = guardDecision(JSON.parse(raw), brokerTools);
    if (decision) process.stdout.write(JSON.stringify(decision) + '\n');
  } catch (error) {
    // Claude Code PreToolUse exit 2 blocks; onFailure:block additionally protects
    // against startup errors, timeouts and incompatible runtime versions.
    process.stderr.write('supervisor boundary rejected tool: ' +
      (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
