// Herdr presentation adapter. Project authority and resource leases live outside the UI.
import { basename, resolve } from 'node:path';

const DEFAULT_TABS = Object.freeze({
  coordinate: 'Ctrl', supervise: 'Ctrl', integrate: 'Ctrl',
  implement: 'Work', refactor: 'Work', fix: 'Work', research: 'Work',
  review: 'Work', verify: 'Work', benchmark: 'Work',
  recover: 'Ctrl', reconcile: 'Ctrl', cleanup: 'Ctrl',
  device: 'Device', serve: 'Device', logs: 'Device',
});
const ALIASES = Object.freeze({implementation:'implement', recovery:'recover', verification:'verify'});
const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,11}$/u;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function fail(message) { throw new Error('layout: ' + message); }
function array(value, name) { if (!Array.isArray(value)) fail('missing/invalid ' + name); return value; }
function block(reason, extra={}) { return {action:'blocked', reason, ...extra}; }

export function resolveLayout(config = {}, functionName) {
  if (!obj(config)) fail('layout must be an object');
  const fn = ALIASES[functionName] ?? functionName;
  if (!Object.hasOwn(DEFAULT_TABS, fn)) fail('unknown execution function: ' + functionName);
  const maxPanes = config.preferredPanesPerTab ?? 4;
  const maxTabs = config.maxTabsPerLane ?? 2;
  if (!Number.isInteger(maxPanes) || maxPanes < 1 || maxPanes > 6) fail('preferredPanesPerTab must be 1..6');
  if (!Number.isInteger(maxTabs) || maxTabs < 1 || maxTabs > 3) fail('maxTabsPerLane must be 1..3');
  const overflow = config.overflow ?? 'queue';
  if (!['queue','new-tab'].includes(overflow)) fail('overflow must be queue or new-tab');
  const overrides = config.functionTabs ?? {};
  if (!obj(overrides) || Object.keys(overrides).some(k => !Object.hasOwn(DEFAULT_TABS, ALIASES[k] ?? k))) fail('unknown functionTabs key');
  const tabLabel = overrides[functionName] ?? overrides[fn] ?? DEFAULT_TABS[fn];
  if (typeof tabLabel !== 'string' || !LABEL.test(tabLabel)) fail('invalid tab label');
  if (config.workspaceLabel !== undefined && (typeof config.workspaceLabel !== 'string' || !LABEL.test(config.workspaceLabel))) fail('invalid workspace label');
  return {function:fn, tabLabel, workspaceLabel:config.workspaceLabel, maxPanes, maxTabs, overflow};
}
export function normalizeSnapshot(response) {
  const result = response?.result ?? response;
  if (!obj(result)) fail('invalid snapshot');
  return {workspaces:array(result.workspaces,'workspaces'), tabs:array(result.tabs,'tabs'),
    panes:array(result.panes,'panes'), agents:array(result.agents,'agents')};
}
const equalPath = (a,b) => typeof a === 'string' && a.length > 0 && resolve(a) === resolve(b);

// Pure and deterministic: no shell creation, no focus changes, no process teardown.
export function planPlacement(snapshotInput, {layout, functionName, cwd, projectRoot, name, workspaceId}) {
  const s = normalizeSnapshot(snapshotInput);
  const cfg = resolveLayout(layout, functionName);
  if (!cwd || !projectRoot || !name) fail('cwd, projectRoot and agent name required');
  const label = cfg.workspaceLabel ?? basename(resolve(projectRoot));
  if (!LABEL.test(label)) fail('workspace label too long; configure short workspaceLabel');
  if (s.agents.some(a => a.name === name || a.agent_name === name)) return block('agent name already exists; reconcile before retry',{name});
  if (s.workspaces.some(w => typeof w.workspace_id !== 'string') ||
    new Set(s.workspaces.map(w=>w.workspace_id)).size !== s.workspaces.length) fail('invalid workspace IDs');
  const matches = workspaceId
    ? s.workspaces.filter(w => w.workspace_id === workspaceId)
    : s.workspaces.filter(w => s.panes.some(p => p.workspace_id === w.workspace_id && equalPath(p.cwd,projectRoot)));
  if (workspaceId && matches.length !== 1) return block('explicit workspace not found');
  if (matches.length > 1) return block('multiple workspaces match projectRoot; use --workspace-id');
  if (!matches.length) {
    if (s.workspaces.some(w => w.label === label)) return block('workspace label collision with unverified cwd; specify --workspace-id');
    return {action:'create-workspace',workspaceLabel:label,tabLabel:cfg.tabLabel,
      cwd:resolve(cwd),projectRoot:resolve(projectRoot),function:cfg.function};
  }
  const workspace = matches[0].workspace_id;
  const laneTabs = s.tabs.filter(t => t.workspace_id === workspace &&
    (t.label === cfg.tabLabel || (t.label.startsWith(cfg.tabLabel) && /^[2-9]$/.test(t.label.slice(cfg.tabLabel.length)))))
    .sort((a,b) => (a.label === cfg.tabLabel ? -1 : b.label === cfg.tabLabel ? 1 : a.label.localeCompare(b.label)));
  if (new Set(laneTabs.map(t=>t.label)).size !== laneTabs.length) return block('duplicate tab labels; reconcile',{workspace});
  for (const tab of laneTabs) {
    const panes = s.panes.filter(p => p.tab_id === tab.tab_id);
    if ((typeof tab.pane_count === 'number' && tab.pane_count !== panes.length) ||
        !panes.length || panes.some(p=>typeof p.pane_id !== 'string')) return block('inconsistent pane inventory; refresh',{tab:tab.tab_id});
    if (panes.length < cfg.maxPanes) return {action:'split-pane',workspace,tab:tab.tab_id,
      targetPane:panes[panes.length-1].pane_id,
      direction:panes.length % 2 ? 'right':'down',cwd:resolve(cwd),function:cfg.function};
  }
  if (!laneTabs.length) return {action:'create-tab',workspace,tabLabel:cfg.tabLabel,cwd:resolve(cwd),function:cfg.function};
  if (cfg.overflow === 'new-tab' && laneTabs.length < cfg.maxTabs) {
    const used = new Set(laneTabs.map(t=>t.label));
    const next = Array.from({length:cfg.maxTabs-1},(_,i)=>cfg.tabLabel+(i+2)).find(x=>!used.has(x));
    if (next && next.length <= 12) return {action:'create-tab',workspace,tabLabel:next,cwd:resolve(cwd),function:cfg.function};
  }
  return {action:'queued',reason:'pane capacity reached; no layout growth authorized',workspace,tabLabel:cfg.tabLabel,function:cfg.function};
}
