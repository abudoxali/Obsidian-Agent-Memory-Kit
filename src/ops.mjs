// Operational commands: init, project add, status, doctor, sentinel, prune.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { VymemError } from './errors.mjs';
import { DEFAULT_CONFIG, normalizeConfig, saveConfig, deepMerge, defaultConfigDir } from './config.mjs';
import { Vault } from './vault.mjs';
import { listProjects, scanWorkspaces, listHandoffRecords } from './project.mjs';
import { listProposals } from './proposals.mjs';
import { submitKnowledgeEntry } from './intake.mjs';
import { inspectClients, CLIENT_NAMES, clientHome } from './clients.mjs';
import { gitAvailable } from './git.mjs';
import { pruneLedgers } from './hooks/handler.mjs';
import { readJson } from './fsutil.mjs';
import { SERVER_VERSION } from './mcp/server.mjs';

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- init
export function initVault({ vaultPath, configPath, clients = [], workspaces = [] }) {
  if (!vaultPath) throw new VymemError('INVALID_ARGUMENTS', '--vault <directory> is required.');
  const vaultAbs = path.resolve(vaultPath);
  const existed = fs.existsSync(vaultAbs);
  if (existed && !fs.statSync(vaultAbs).isDirectory()) throw new VymemError('INVALID_ARGUMENTS', `${vaultAbs} is not a directory.`);
  for (const c of clients) if (!CLIENT_NAMES.includes(c)) throw new VymemError('INVALID_ARGUMENTS', `Unknown client '${c}'. Supported: ${CLIENT_NAMES.join(', ')}`);

  const previous = fs.existsSync(configPath) ? readJson(configPath, null) : null;
  if (fs.existsSync(configPath) && previous === null) throw new VymemError('INVALID_CONFIG', `Existing config is not valid JSON: ${configPath}`);
  const patch = { vault: { path: vaultAbs } };
  if (workspaces.length) patch.workspaces = { roots: [...new Set([...(previous?.workspaces?.roots || []), ...workspaces.map(w => path.resolve(w))])] };
  if (clients.length) patch.clients = Object.fromEntries(clients.map(c => [c, { enabled: true }]));
  const cfg = normalizeConfig(deepMerge(previous || JSON.parse(JSON.stringify(DEFAULT_CONFIG)), patch));

  fs.mkdirSync(vaultAbs, { recursive: true });
  const vault = new Vault(cfg);
  const created = [];
  for (const f of Object.values(cfg.vault.folders)) {
    const dir = path.join(vault.root, ...f.split('/'));
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); created.push(f); }
  }
  fs.mkdirSync(vault.stateDir, { recursive: true });
  const welcome = path.join(vault.root, 'Welcome to VYMEM.md');
  if (!fs.existsSync(welcome)) {
    fs.writeFileSync(welcome, [
      '---', 'entity_type: guide', 'title: "Welcome to VYMEM"', `last_verified: ${today()}`, 'summary: "How this vault is used by VYMEM."', '---', '',
      '# Welcome to VYMEM', '',
      `- **${cfg.vault.folders.projects}/** - one note per project. Create with \`vymem project add\`.`,
      `- **${cfg.vault.folders.decisions}/** and **${cfg.vault.folders.memory}/** - your durable knowledge. Agents read it; only you change it.`,
      `- **${cfg.vault.folders.inbox}/** - drafts and handoffs written by agents. Always unapproved.`,
      `- **${cfg.vault.folders.proposals}/** - update proposals waiting for your review (\`vymem proposals list\`).`, ''
    ].join('\n'), 'utf8');
    created.push('Welcome to VYMEM.md');
  }
  saveConfig(configPath, cfg);
  return { configPath, vault: vault.root, existing_obsidian_vault: fs.existsSync(path.join(vault.root, '.obsidian')), created, clients: Object.entries(cfg.clients).filter(([, v]) => v.enabled).map(([k]) => k) };
}

export function addProject(vault, { name, path: localPath, repository_url, summary, tech }) {
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}$/.test(name)) throw new VymemError('INVALID_ARGUMENTS', 'Project name must be 1-81 characters of letters, digits, space, dot, dash or underscore.');
  const rel = `${vault.folders.projects}/${name}.md`;
  const { abs } = vault.resolve(rel, { forWrite: true });
  if (fs.existsSync(abs)) throw new VymemError('ALREADY_EXISTS', `Project note already exists: ${rel}`);
  const fm = [
    '---', 'entity_type: project', `project_name: "${name}"`, 'lifecycle: active', 'verification_status: owner_authored',
    ...(localPath ? [`local_path: "${path.resolve(localPath).replace(/\\/g, '/')}"`] : []),
    ...(repository_url ? [`repository_url: "${repository_url}"`] : []),
    ...(tech ? [`tech_stack: "${tech}"`] : []), `last_verified: ${today()}`, `summary: "${(summary || 'Describe this project in one sentence.').replace(/"/g, "'")}"`, '---'
  ];
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, [...fm, '', `# ${name}`, '', '## Purpose', 'What this project is for.', '', '## Architecture', 'Key components and boundaries.', '', '## Status', 'Current state, with evidence.', '', '## Blockers', 'None recorded.', '', '## Next steps', '- ', ''].join('\n'), 'utf8');
  vault.audit({ action: 'PROJECT_ADD', path: rel, actor: 'local_operator_cli' });
  return { status: 'CREATED', path: rel };
}

// ---------------------------------------------------------------- status & doctor
export function statusReport(vault, cfg, ctx) {
  const notes = vault.collectMarkdown();
  const handoffs = listHandoffRecords(vault);
  const audit = (() => {
    try { const lines = fs.readFileSync(vault.statePath('audit-log.jsonl'), 'utf8').trim().split('\n'); return { events: lines.length, last: JSON.parse(lines[lines.length - 1]) }; } catch { return { events: 0, last: null }; }
  })();
  return {
    version: SERVER_VERSION,
    config: ctx.configPath,
    vault: { root: vault.root, notes: notes.length, projects: listProjects(vault).length },
    inbox: { handoffs: handoffs.length, unapproved_handoffs: handoffs.filter(h => h.fields.approved_by_owner !== true).length },
    pending_proposals: listProposals(vault).proposals.length,
    audit,
    mcp: { permission: cfg.mcp.permission, serverName: cfg.mcp.serverName },
    hooks: { enabled: cfg.hooks.enabled, capture: cfg.hooks.captureEnabled },
    sentinel: { enabled: cfg.sentinel.enabled },
    clients: inspectClients(CLIENT_NAMES, ctx)
  };
}

export function probeMcp(node, cli, configPath, timeoutMs = 8000) {
  return new Promise(resolve => {
    const child = cp.spawn(node, [cli, 'mcp', '--config', configPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    const done = r => { clearTimeout(timer); try { child.kill(); } catch { /* gone */ } resolve(r); };
    const timer = setTimeout(() => done({ ok: false, error: 'timeout' }), timeoutMs);
    child.on('error', e => done({ ok: false, error: e.message }));
    child.stdout.on('data', d => {
      out += d;
      const lines = out.split('\n').filter(Boolean);
      const init = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const list = init.find(m => m.id === 2);
      if (list) done({ ok: Boolean(list.result?.tools?.length), tools: (list.result?.tools || []).map(t => t.name), server: init.find(m => m.id === 1)?.result?.serverInfo });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'vymem-doctor', version: '0' } } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  });
}

export async function doctor(cfgLoader, ctx) {
  const checks = [];
  const add = (name, ok, detail, level = ok ? 'pass' : 'fail') => checks.push({ name, level, detail });
  const major = Number(process.versions.node.split('.')[0]);
  add('Node.js >= 20', major >= 20, `running ${process.version}`);
  add('git available (optional: freshness, project identification, hooks)', gitAvailable(), gitAvailable() ? 'found' : 'not found: freshness and repo identification are disabled', gitAvailable() ? 'pass' : 'warn');
  let cfg; let vault;
  try { cfg = cfgLoader(); add('Config valid', true, ctx.configPath); } catch (e) { add('Config valid', false, e.message); return checks; }
  try {
    vault = new Vault(cfg); add('Vault reachable', true, vault.root);
    const probe = path.join(vault.stateDir, `.doctor-${process.pid}`);
    fs.mkdirSync(vault.stateDir, { recursive: true }); fs.writeFileSync(probe, 'x'); fs.unlinkSync(probe);
    add('Vault state directory writable', true, vault.stateRel);
  } catch (e) { add('Vault reachable and writable', false, e.message); return checks; }
  for (const [k, f] of Object.entries(cfg.vault.folders)) {
    const exists = fs.existsSync(path.join(vault.root, ...f.split('/')));
    add(`Folder '${f}' (${k})`, exists, exists ? 'present' : 'missing (run vymem init)', exists ? 'pass' : 'warn');
  }
  add('Project notes found', listProjects(vault).length > 0, `${listProjects(vault).length} project note(s)`, listProjects(vault).length ? 'pass' : 'warn');
  const probeRes = await probeMcp(ctx.node, ctx.cli, ctx.configPath);
  add('MCP gateway handshake (initialize + tools/list)', probeRes.ok, probeRes.ok ? `${probeRes.tools.length} tools: ${probeRes.tools.join(', ')}` : probeRes.error || 'no tools returned');
  for (const c of inspectClients(CLIENT_NAMES, ctx)) {
    const enabled = cfg.clients[c.client]?.enabled;
    const lvl = s => (s === 'registered' ? 'pass' : (s === 'foreign_entry' || String(s).startsWith('error') ? 'fail' : (enabled ? 'warn' : 'info')));
    add(`${c.label}: MCP registration`, c.mcp === 'registered', `${c.mcp} (${c.mcp_file})`, lvl(c.mcp));
    add(`${c.label}: hooks`, c.hooks === 'registered', `${c.hooks}${cfg.hooks.enabled ? '' : ' (hooks.enabled=false: hooks would do nothing)'}`, c.hooks === 'registered' ? (cfg.hooks.enabled ? 'pass' : 'warn') : 'info');
  }
  add('Secret screen self-test', vault.scanner.detect('sk-' + 'a'.repeat(30)).length > 0, 'built-in patterns active');
  add('Monitoring (sentinel)', true, cfg.sentinel.enabled ? 'enabled' : 'disabled (default)', 'info');
  return checks;
}

// ---------------------------------------------------------------- sentinel (optional, off by default)
export function runSentinel(vault, cfg) {
  if (!cfg.sentinel.enabled) throw new VymemError('SENTINEL_DISABLED', "Sentinel is disabled. Enable explicitly: vymem config set sentinel.enabled true");
  if (!cfg.workspaces.roots.length) throw new VymemError('NO_WORKSPACE_ROOTS', 'No workspace roots configured (workspaces.roots).');
  const repos = scanWorkspaces(vault, cfg);
  const show = r => (cfg.privacy.recordAbsolutePaths ? `${r.name} (${r.root})` : r.name);
  const rows = repos.map(r => `| ${show(r)} | ${r.project || '(unmapped)'} | ${r.branch || '-'} | ${r.head || '-'} | ${r.dirty_files ?? '?'} | ${r.has_status_md ? 'yes' : 'no'} | ${r.freshness}${r.signals.length ? ` (${r.signals.join(', ')})` : ''} |`);
  const stale = repos.filter(r => r.freshness === 'potentially_stale').length;
  const unmapped = repos.filter(r => !r.project).length;
  const body = [
    'Machine-observed snapshot of git repositories under the configured workspace roots. Read-only: no repository and no approved note was modified.', '',
    '| Repository | Project note | Branch | HEAD | Dirty files | STATUS.md | Freshness |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows, '',
    `Totals: ${repos.length} repositories, ${stale} potentially stale, ${unmapped} without a project note.`
  ].join('\n');
  const res = submitKnowledgeEntry(vault, {
    record_id: 'vymem-sentinel-workspace', title: 'Sentinel - workspace repositories', category: 'ai_inbox',
    target_path: `${vault.folders.inbox}/sentinel/workspace-snapshot.md`, body, summary: `${repos.length} repositories scanned; ${stale} potentially stale; ${unmapped} unmapped.`,
    source_system: 'vymem_sentinel', source_reference: 'vymem:sentinel:workspace', owner_agent: 'VYMEM Sentinel',
    verification_status: 'machine_observed_snapshot', tags: ['type/sentinel', 'status/machine-observed']
  });
  return { repos: repos.length, stale, unmapped, record: res.status, path: res.path };
}

// ---------------------------------------------------------------- retention
export function prune(vault, cfg, { apply = false } = {}) {
  const day = 86400000;
  const out = { backups: 0, audit_lines: 0, ledgers: 0, applied: apply };
  const bdir = vault.statePath('backups');
  try {
    for (const d of fs.readdirSync(bdir)) {
      const t = Date.parse(d);
      if (Number.isFinite(t) && Date.now() - t > cfg.retention.backupsDays * day) { out.backups++; if (apply) fs.rmSync(path.join(bdir, d), { recursive: true, force: true }); }
    }
  } catch { /* no backups */ }
  const alog = vault.statePath('audit-log.jsonl');
  try {
    const lines = fs.readFileSync(alog, 'utf8').split('\n').filter(Boolean);
    const keep = lines.filter(l => { try { return Date.now() - Date.parse(JSON.parse(l).timestamp) <= cfg.retention.auditDays * day; } catch { return true; } });
    out.audit_lines = lines.length - keep.length;
    if (apply && out.audit_lines) fs.writeFileSync(alog, keep.join('\n') + (keep.length ? '\n' : ''), 'utf8');
  } catch { /* no log */ }
  const sdir = vault.statePath('sessions');
  try { out.ledgers = fs.readdirSync(sdir).filter(f => Date.now() - fs.statSync(path.join(sdir, f)).mtimeMs > cfg.retention.sessionLedgerDays * day).length; } catch { /* none */ }
  if (apply && out.ledgers) pruneLedgers(vault, cfg.retention.sessionLedgerDays);
  return out;
}

export { defaultConfigDir, clientHome };
