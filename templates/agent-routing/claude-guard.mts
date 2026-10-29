#!/usr/bin/env node
// Claude Code PreToolUse guard, opt-in for projects where native delegation is forbidden.
// It does not protect arbitrary shell commands or other harnesses.
import { stdin } from 'node:process';
let body='';
for await (const chunk of stdin) body+=chunk;
let req: unknown;
try { req=JSON.parse(body); } catch { process.exitCode=2; process.exit(); }
if (typeof req === 'object' && req !== null && 'tool_name' in req &&
    typeof req.tool_name === 'string' && ['Agent','Task'].includes(req.tool_name)) {
  console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',
    permissionDecisionReason:'Use project-local agent-routing dispatch with the configured Herdr/provider route; native subagents are forbidden for external delegation.'}}));
}
