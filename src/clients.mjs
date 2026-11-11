// Client integrations (Claude Code, Codex, Antigravity): MCP registration + lifecycle hooks.
// Rules: never overwrite foreign entries, merge instead; back up before every change; skip the write
// (and the backup) when nothing would change; remove only entries carrying VYMEM's marker.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VymemError } from './errors.mjs';
import { writeFileAtomic } from './fsutil.mjs';

export const MARK = '--managed-by=vymem';
const BLOCK_BEGIN = '# >>> vymem managed block (do not edit; remove with `vymem uninstall`) >>>';
const BLOCK_END = '# <<< vymem managed block <<<';

export const toFwd = p => String(p).split(path.sep).join('/');
export const clientHome = (opts = {}) => path.resolve(opts.home || process.env.VYMEM_CLIENT_HOME || os.homedir());
const isOurs = v => JSON.stringify(v ?? {}).includes(MARK);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function backupFile(file, backupDir) {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, `${path.basename(file)}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);
  fs.copyFileSync(file, dest);
  return dest;
}

function readJsonStrict(file) {
  if (!fs.existsSync(file)) return { exists: false, value: {} };
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return { exists: true, value: {} };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return { exists: true, value };
  } catch {
    throw new VymemError('INVALID_CLIENT_CONFIG', `${file} is not valid JSON; refusing to modify it. Fix or move the file and retry.`, { file });
  }
}

// Apply `mutate` to a JSON config. Writes (after a backup) only when the result differs.
function editJson(file, backupDir, dryRun, mutate) {
  const { exists, value } = readJsonStrict(file);
  const before = JSON.parse(JSON.stringify(value));
  const after = mutate(JSON.parse(JSON.stringify(value)));
  if (same(before, after)) return { file, changed: false, backup: null };
  if (dryRun) return { file, changed: true, backup: null, dryRun: true };
  const backup = exists ? backupFile(file, backupDir) : null;
  writeFileAtomic(file, JSON.stringify(after, null, 2) + '\n');
  return { file, changed: true, backup };
}

function editText(file, backupDir, dryRun, mutate) {
  const exists = fs.existsSync(file);
  const before = exists ? fs.readFileSync(file, 'utf8') : '';
  const after = mutate(before);
  if (after === before) return { file, changed: false, backup: null };
  if (dryRun) return { file, changed: true, backup: null, dryRun: true };
  const backup = exists ? backupFile(file, backupDir) : null;
  writeFileAtomic(file, after);
  return { file, changed: true, backup };
}

function mergeHookMap(existing, ours) {
  const out = { ...(existing || {}) };
  for (const [event, groups] of Object.entries(ours)) out[event] = [...(out[event] || []).filter(g => !isOurs(g)), ...groups];
  for (const [event, groups] of Object.entries(out)) {
    if (!ours[event]) {
      const kept = groups.filter(g => !isOurs(g));
      if (kept.length) out[event] = kept; else delete out[event];
    }
  }
  return out;
}

const cmdFor = (ctx, client, event) =>
  `"${toFwd(ctx.node)}" "${toFwd(ctx.cli)}" hook ${client} ${event} --config "${toFwd(ctx.configPath)}" ${MARK}`;

const group = (ctx, client, event, timeout, matcher) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: cmdFor(ctx, client, event), timeout }] });

const mcpEntry = ctx => ({ command: toFwd(ctx.node), args: [toFwd(ctx.cli), 'mcp', '--config', toFwd(ctx.configPath), MARK] });

function jsonMcp(fileFn, extra = {}) {
  return {
    file: fileFn,
    install: (ctx, file) => editJson(file, ctx.backupDir, ctx.dryRun, v => {
      const servers = { ...(v.mcpServers || {}) };
      const cur = servers[ctx.serverName];
      if (cur && !isOurs(cur)) {
        throw new VymemError('FOREIGN_ENTRY_CONFLICT', `${file} already has an mcpServers.${ctx.serverName} entry not created by VYMEM. Remove it or choose another mcp.serverName.`, { file });
      }
      servers[ctx.serverName] = { ...extra, ...mcpEntry(ctx) };
      return { ...v, mcpServers: servers };
    }),
    uninstall: (ctx, file) => editJson(file, ctx.backupDir, ctx.dryRun, v => {
      const cur = v.mcpServers?.[ctx.serverName];
      if (!cur || !isOurs(cur)) return v;
      const servers = { ...v.mcpServers };
      delete servers[ctx.serverName];
      return { ...v, mcpServers: servers };
    }),
    inspect: (ctx, file) => {
      if (!fs.existsSync(file)) return 'absent';
      const cur = readJsonStrict(file).value.mcpServers?.[ctx.serverName];
      return !cur ? 'absent' : (isOurs(cur) ? 'registered' : 'foreign_entry');
    }
  };
}

const tomlMcp = {
  file: home => path.join(home, '.codex', 'config.toml'),
  block: ctx => [BLOCK_BEGIN, `[mcp_servers.${ctx.serverName}]`, `command = ${JSON.stringify(toFwd(ctx.node))}`,
    `args = ${JSON.stringify(mcpEntry(ctx).args)}`, BLOCK_END].join('\n'),
  install(ctx, file) {
    return editText(file, ctx.backupDir, ctx.dryRun, text => {
      const re = new RegExp(`${BLOCK_BEGIN.replace(/[.*+?^${}()|[\]\\`]/g, '\\$&')}[\\s\\S]*?${BLOCK_END.replace(/[.*+?^${}()|[\]\\`]/g, '\\$&')}`);
      const block = this.block(ctx);
      if (re.test(text)) return text.replace(re, () => block);
      if (text.includes(`[mcp_servers.${ctx.serverName}]`)) {
        throw new VymemError('FOREIGN_ENTRY_CONFLICT', `${file} already defines [mcp_servers.${ctx.serverName}] outside a VYMEM block. Remove it or choose another mcp.serverName.`, { file });
      }
      return text.replace(/\s*$/, '') + (text.trim() ? '\n\n' : '') + block + '\n';
    });
  },
  uninstall(ctx, file) {
    return editText(file, ctx.backupDir, ctx.dryRun, text => {
      const esc = s => s.replace(/[.*+?^${}()|[\]\\`]/g, '\\$&');
      const re = new RegExp(`\\n*${esc(BLOCK_BEGIN)}[\\s\\S]*?${esc(BLOCK_END)}\\n?`);
      return text.replace(re, '\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
    });
  },
  inspect(ctx, file) {
    if (!fs.existsSync(file)) return 'absent';
    const t = fs.readFileSync(file, 'utf8');
    if (t.includes(BLOCK_BEGIN)) return 'registered';
    return t.includes(`[mcp_servers.${ctx.serverName}]`) ? 'foreign_entry' : 'absent';
  }
};

function jsonHooks(fileFn, buildGroups) {
  return {
    file: fileFn,
    install: (ctx, file) => editJson(file, ctx.backupDir, ctx.dryRun, v => ({ ...v, hooks: mergeHookMap(v.hooks, buildGroups(ctx)) })),
    uninstall: (ctx, file) => editJson(file, ctx.backupDir, ctx.dryRun, v => {
      if (!v.hooks) return v;
      const merged = mergeHookMap(v.hooks, {});
      const out = { ...v };
      if (Object.keys(merged).length) out.hooks = merged; else delete out.hooks;
      return out;
    }),
    inspect: (ctx, file) => (fs.existsSync(file) && isOurs(readJsonStrict(file).value.hooks) ? 'registered' : 'absent')
  };
}

const namedHooks = {
  file: home => path.join(home, '.gemini', 'config', 'hooks.json'),
  install: (ctx, file) => editJson(file, ctx.backupDir, ctx.dryRun, v => {
    if (v.vymem && !isOurs(v.vymem)) throw new VymemError('FOREIGN_ENTRY_CONFLICT', `${file} already has a 'vymem' hook not created by VYMEM.`, { file });
    return { ...v, vymem: {
      PreInvocation: [{ type: 'command', command: cmdFor(ctx, 'antigravity', 'PreInvocation'), timeout: 10 }],
      Stop: [{ type: 'command', command: cmdFor(ctx, 'antigravity', 'Stop'), timeout: 8 }]
    } };
  }),
  uninstall: (ctx, file) => editJson(file, ctx.backupDir, ctx.dryRun, v => {
    if (!v.vymem || !isOurs(v.vymem)) return v;
    const out = { ...v }; delete out.vymem; return out;
  }),
  inspect: (ctx, file) => (fs.existsSync(file) && isOurs(readJsonStrict(file).value.vymem) ? 'registered' : 'absent')
};

// File locations follow what was observed in one private deployment; see docs/compatibility.md.
export const CLIENTS = {
  claude: {
    label: 'Claude Code',
    mcp: jsonMcp(home => path.join(home, '.claude.json'), { type: 'stdio' }),
    hooks: jsonHooks(home => path.join(home, '.claude', 'settings.json'), ctx => ({
      SessionStart: [group(ctx, 'claude', 'SessionStart', 10)],
      UserPromptSubmit: [group(ctx, 'claude', 'UserPromptSubmit', 5)],
      PostToolUse: [group(ctx, 'claude', 'PostToolUse', 5, 'Edit|Write|MultiEdit|NotebookEdit|Bash')],
      Stop: [group(ctx, 'claude', 'Stop', 8)],
      SessionEnd: [group(ctx, 'claude', 'SessionEnd', 5)]
    }))
  },
  codex: {
    label: 'Codex',
    mcp: tomlMcp,
    hooks: jsonHooks(home => path.join(home, '.codex', 'hooks.json'), ctx => ({
      SessionStart: [group(ctx, 'codex', 'SessionStart', 10)],
      UserPromptSubmit: [group(ctx, 'codex', 'UserPromptSubmit', 5)],
      PostToolUse: [group(ctx, 'codex', 'PostToolUse', 5, 'Bash|apply_patch|Edit|Write')],
      Stop: [group(ctx, 'codex', 'Stop', 8)]
    }))
  },
  antigravity: {
    label: 'Antigravity',
    mcp: jsonMcp(home => path.join(home, '.gemini', 'config', 'mcp_config.json')),
    hooks: namedHooks
  }
};

export const CLIENT_NAMES = Object.keys(CLIENTS);

export function applyClients(names, ctx, { mcp, hooks, remove = false }) {
  const home = ctx.home;
  const results = [];
  for (const name of names) {
    const def = CLIENTS[name];
    if (!def) throw new VymemError('INVALID_ARGUMENTS', `Unknown client '${name}'. Supported: ${CLIENT_NAMES.join(', ')}`);
    const r = { client: name, steps: [] };
    for (const [kind, on] of [['mcp', mcp], ['hooks', hooks]]) {
      if (!on) continue;
      const file = def[kind].file(home);
      const op = remove ? def[kind].uninstall : def[kind].install;
      r.steps.push({ kind, ...op.call(def[kind], ctx, file) });
    }
    results.push(r);
  }
  return results;
}

export function inspectClients(names, ctx) {
  return names.map(name => {
    const def = CLIENTS[name];
    const out = { client: name, label: def.label };
    for (const kind of ['mcp', 'hooks']) {
      const file = def[kind].file(ctx.home);
      try { out[kind] = def[kind].inspect.call(def[kind], ctx, file); } catch (e) { out[kind] = `error:${e.code || 'unreadable'}`; }
      out[`${kind}_file`] = file;
    }
    return out;
  });
}
