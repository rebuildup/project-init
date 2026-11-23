#!/usr/bin/env -S bun
import { readFileSync } from 'node:fs';

const BASIS_FIELDS = ['scope', 'value', 'waiting', 'change_risk', 'release_cost'] as const;
const TRIGGERS = new Set(['weekly', 'change_limit', 'value', 'wait_limit', 'urgent', 'manual']);
const OUTCOMES = new Set(['hold', 'candidate', 'blocked']);
const STAGES = new Set(['collecting', 'frozen', 'verified']);
const NO_EVIDENCE = new Set(['', 'unknown', 'n/a', 'na', 'none', 'not measured', 'unavailable', '?']);
const SHA = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const ONLY_COUNTS = /^\d+\s+(?:files?|prs?|commits?|changes?)(?:\s+changed)?(?:\s*(?:,|;|and|&)\s*\d+\s+(?:files?|prs?|commits?|changes?)(?:\s+changed)?)*$/;
const ADMISSION_TRACKS = new Set(['critical-path', 'research-discovery', 'backlog']);
const ITEM_TYPES = new Set(['bug', 'feature', 'chore']);
const BOOLEAN_ADMISSION_CRITERIA = [
  'requirement_confirmed',
  'acceptance_executable',
  'dependency_owner_identified',
  'validation_path_defined',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function substantive(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return !NO_EVIDENCE.has(normalized) && !ONLY_COUNTS.test(normalized);
}

export function check(data: unknown): string[] {
  const failures: string[] = [];
  if (!isRecord(data)) return ['decision must be a JSON object'];

  const field = (name: string): unknown => {
    if (!Object.hasOwn(data, name)) failures.push('missing field: ' + name);
    return data[name];
  };

  const trigger = field('trigger');
  const outcome = field('outcome');
  const stage = field('stage');
  const basis = field('basis');
  const admitted = field('admission_passed');
  const candidateSha = field('candidate_sha');
  const validatedSha = field('validated_sha');
  const gatePassed = field('release_gate_passed');
  const ticketLanding = field('ticket_landing_requested');
  const releaseMerge = field('release_merge_requested');
  const authorized = field('release_authorized');
  const authorizedSha = field('authorized_sha');

  if (typeof trigger !== 'string' || !TRIGGERS.has(trigger)) failures.push('invalid release review trigger');
  if (typeof outcome !== 'string' || !OUTCOMES.has(outcome)) failures.push('invalid review outcome');
  if (typeof stage !== 'string' || !STAGES.has(stage)) failures.push('invalid candidate stage');

  if (!isRecord(basis)) {
    failures.push('basis must contain scope/value/waiting/change_risk/release_cost');
  } else {
    for (const name of BASIS_FIELDS) {
      const value = basis[name];
      if (typeof value !== 'string' || !value.trim()) failures.push('missing basis: ' + name);
    }
  }

  for (const [name, value] of [
    ['admission_passed', admitted],
    ['release_gate_passed', gatePassed],
    ['ticket_landing_requested', ticketLanding],
    ['release_merge_requested', releaseMerge],
    ['release_authorized', authorized],
  ] as const) {
    if (typeof value !== 'boolean') failures.push(name + ' must be a boolean');
  }

  if (Object.hasOwn(data, 'promoted_by_calendar_only')) {
    if (typeof data.promoted_by_calendar_only !== 'boolean') {
      failures.push('promoted_by_calendar_only must be a boolean');
    } else if (data.promoted_by_calendar_only === true) {
      failures.push('calendar target alone cannot admit unknowns to release critical path');
    }
  }

  if (Object.hasOwn(data, 'admission_items')) {
    const items = data.admission_items;
    if (!Array.isArray(items)) {
      failures.push('admission_items must be an array');
    } else {
      let criticalPathCount = 0;
      for (const [idx, raw] of items.entries()) {
        if (!isRecord(raw)) {
          failures.push('admission_items[' + idx + '] must be an object');
          continue;
        }
        const hasValidId = typeof raw.id === 'string' && raw.id.trim().length > 0;
        const id = hasValidId ? (raw.id as string).trim() : '#' + idx;
        if (!hasValidId) {
          failures.push('admission_items[' + idx + '] requires a non-empty id');
        }
        const track = raw.track;
        if (typeof track !== 'string' || !ADMISSION_TRACKS.has(track)) {
          failures.push('admission item ' + id + ' has invalid track');
          continue;
        }
        if (Object.hasOwn(raw, 'item_type')) {
          if (typeof raw.item_type !== 'string' || !ITEM_TYPES.has(raw.item_type)) {
            failures.push('admission item ' + id + ' has invalid item_type');
          }
        }
        if (Object.hasOwn(raw, 'promoted_by_calendar_only')) {
          if (typeof raw.promoted_by_calendar_only !== 'boolean') {
            failures.push('admission item ' + id + ' promoted_by_calendar_only must be a boolean');
          } else if (raw.promoted_by_calendar_only === true && track === 'critical-path') {
            failures.push('calendar target alone cannot admit critical-path item ' + id);
          }
        }
        // Research/discovery and backlog items may run with open unknowns;
        // critical-path items must pass all 5 admission criteria.
        if (track === 'critical-path') {
          criticalPathCount++;
          for (const key of BOOLEAN_ADMISSION_CRITERIA) {
            if (raw[key] !== true) {
              failures.push('critical-path item ' + id + ' failed admission criterion: ' + key);
            }
          }
          const itemType = typeof raw.item_type === 'string' ? raw.item_type : undefined;
          const bugCriterion = raw.bug_reproduced_or_pinpointed;
          if (itemType === 'feature' || itemType === 'chore') {
            if (bugCriterion !== true && bugCriterion !== 'not-applicable') {
              failures.push('critical-path item ' + id + ' failed admission criterion: bug_reproduced_or_pinpointed');
            }
          } else {
            // Bug items (or omitted item_type) must prove reproduction/pinpointing and cannot evade with 'not-applicable'.
            if (bugCriterion === 'not-applicable') {
              failures.push('critical-path bug item ' + id + ' cannot use not-applicable for bug_reproduced_or_pinpointed');
            } else if (bugCriterion !== true) {
              failures.push('critical-path item ' + id + ' failed admission criterion: bug_reproduced_or_pinpointed');
            }
          }
        }
      }
      if (outcome === 'candidate' && criticalPathCount === 0) {
        failures.push('candidate with admission_items requires at least one critical-path item');
      }
    }
  }

  if (outcome === 'hold' && stage !== 'collecting') {
    failures.push('hold cannot freeze/verify a candidate');
  }
  if (outcome === 'blocked' && stage !== 'collecting') {
    failures.push('blocked cannot freeze/verify a candidate');
  }
  if (outcome === 'candidate') {
    if (admitted !== true) failures.push('candidate requires admitted scope');
    if (isRecord(basis) && typeof basis.scope === 'string' && NO_EVIDENCE.has(basis.scope.trim().toLowerCase())) {
      failures.push('candidate scope must be selected');
    }
    if (isRecord(basis) && !['value', 'waiting', 'change_risk', 'release_cost'].some(name => substantive(basis[name]))) {
      failures.push('candidate requires substantive non-count evidence');
    }
    if (stage !== 'frozen' && stage !== 'verified') {
      failures.push('candidate needs a frozen or verified stage');
    }
  }
  if (stage === 'frozen' || stage === 'verified') {
    if (typeof candidateSha !== 'string' || !SHA.test(candidateSha)) {
      failures.push('freeze requires an immutable candidate SHA');
    }
    if (ticketLanding === true) failures.push('candidate freeze forbids unrelated ticket landing');
  }
  if (stage === 'verified' && (gatePassed !== true || validatedSha !== candidateSha)) {
    failures.push('verified requires a passed gate for current candidate SHA');
  }
  if (releaseMerge === true) {
    if (outcome !== 'candidate' || stage !== 'verified') {
      failures.push('release merge requires a verified candidate');
    }
    if (authorized !== true || authorizedSha !== candidateSha) {
      failures.push('release merge requires explicit authorization for current candidate SHA');
    }
  }
  return failures;
}

function main(args: string[]): number {
  if (args.length !== 1) {
    console.error('usage: grade.mts decision.json');
    return 2;
  }
  let decision: unknown;
  try {
    decision = JSON.parse(readFileSync(args[0], 'utf8')) as unknown;
  } catch (error) {
    console.log('INVALID ' + String(error));
    console.log('EVAL FAIL');
    return 1;
  }
  const failures = check(decision);
  for (const failure of failures) console.log('VIOL ' + failure);
  console.log(failures.length ? 'EVAL FAIL' : 'EVAL PASS');
  return failures.length ? 1 : 0;
}

if (process.argv[1]?.endsWith('/grade.mts') || process.argv[1] === 'grade.mts') {
  process.exitCode = main(process.argv.slice(2));
}
