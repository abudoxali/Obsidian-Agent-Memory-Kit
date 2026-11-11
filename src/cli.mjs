// VYMEM command line interface.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VymemError, errorPayload } from './errors.mjs';
import { resolveConfigPath, loadConfig, saveConfig, getByPath, setByPath } from './config.mjs';
import { Vault } from './vault.mjs';
import { knowledgeSearch } from './search.mjs';
import { getProjectContext, resolveWorkspace, listProjects, scanWorkspaces, listHandoffRecords } from './project.mjs';
import { approveRecord } from './intake.mjs';
import { listProposals, applyProposal, rejectProposal } from './proposals.mjs';
import { createRequestHandler, serveStdio, SERVER_VERSION } from './mcp/server.mjs';
import { handleHook } from './hooks/handler.mjs';
import { applyClients, inspectClients, CLIENT_NAMES, clientHome } from './clients.mjs';
import { initVault, addProject, statusReport, doctor, runSentinel, prune } from './ops.mjs';
import { readJson, writeJsonAtomic } from './fsutil.mjs';

const CLI_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'vymem.mjs');
const VALUE_FLAGS = new Set(['config', 'vault', 'clients', 'client', 'workspace', 'home', 'limit', 'by', 'reason', 'expected-sha', 'folder', 'entity-type', 'cwd', 'path', 'repository-url', 'summary', 'tech', 'permission', 'backup', 'target', 'interval']);
const REPEAT_FLAGS = new Set(['workspace']);

export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    let [k, v] = a.slice(2).split(/=(.*)/s);
    if (v === undefined && VALUE_FLAGS.has(k) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) v = argv[++i];
    const val = v === undefined ? true : v;
    if (REPEAT_FLAGS.has(k)) (out.flags[k] ||= []).push(val); else out.flags[k] = val;
  }
  return out;
}

const HELP = `VYMEM - shared memory for coding agents (v${SERVER_VERSION})

Setup
  vymem init --vault <dir> [--clients claude,codex,antigravity] [--workspace <dir>]...
  vymem install [--client claude,codex,antigravity|all] [--mcp] [--hooks] --yes [--home <dir>]
  vymem uninstall [--client ...|all] --yes [--purge-config]
  vymem doctor | vymem status

Knowledge
  vymem search <query> [--limit n] [--folder f] [--entity-type t]
  vymem context [<project>] [--cwd <dir>]
  vymem project add <name> [--path <repo>] [--repository-url u] [--summary s] [--tech t] | list | identify [--cwd dir]
  vymem handoffs [--project <name>]
  vymem freshness

Owner approval (local terminal only; never exposed through MCP)
  vymem approve <record_id> --by <name> --yes
  vymem proposals list [--all] | show <id> | apply <id> --by <name> --yes [--expected-sha <sha>] | reject <id> --by <name> --yes
  vymem rollback --backup <vault-relative backup path> --target <note> --by <name> --yes

Operation
  vymem sentinel run | watch | status      (disabled until: vymem config set sentinel.enabled true)
  vymem config path | get <key> | set <key> <json-value>
  vymem prune [--yes]
  vymem mcp [--permission read|propose]   (stdio MCP server; started by your agent client)
  vymem hook <client> <event>             (called by client hooks; always exits 0)

Global: --config <file> (default: user config dir), --json`;

function ctxFor(flags) {
  const configPath = resolveConfigPath({ flag: flags.config });
  const loadCfg = () => loadConfig(configPath);
  return { configPath, loadCfg };
}

const print = obj => console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));

function need(flags, key, hint) {
  if (flags[key] === undefined || flags[key] === true) throw new VymemError('INVALID_ARGUMENTS', hint || `--${key} is required.`);
  return String(flags[key]);
}
function needYes(flags, what) {
  if (flags.yes !== true) throw new VymemError('EXPLICIT_APPROVAL_REQUIRED', `${what} requires explicit --yes.`);
}

async function readStdin(timeoutMs = 1500) {
  if (process.stdin.isTTY) return '';
  return new Promise(resolve => {
    let data = '';
    const t = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { data += c; });
    process.stdin.on('end', () => { clearTimeout(t); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(data); });
  });
}

async function hookCommand(args, flags) {
  // Never throw, never block, always exit 0.
  const [client, event] = args;
  let cfg; let vault;
  try { cfg = loadConfig(resolveConfigPath({ flag: flags.config })); vault = new Vault(cfg); } catch { return 0; }
  try {
    const raw = await readStdin();
    let payload = {};
    try { payload = raw ? JSON.parse(raw.replace(/^﻿/, '').trim()) : {}; } catch { /* bad payload: treat as empty */ }
    const { reply } = handleHook(vault, cfg, client, event, payload);
    if (reply) process.stdout.write(JSON.stringify(reply));
    else if (client === 'antigravity') process.stdout.write('{}');
  } catch (err) {
    try {
      fs.mkdirSync(vault.stateDir, { recursive: true });
      fs.appendFileSync(vault.statePath('hook.log'), `${new Date().toISOString()} ${client}/${event} ${String(err?.code || err?.message || err).slice(0, 200)}\n`);
    } catch { /* logging is best effort */ }
  }
  return 0;
}

export async function main(argv) {
  const { _: pos, flags } = parseArgs(argv);
  const cmd = pos[0];
  if (!cmd || cmd === 'help' || flags.help) { print(HELP); return 0; }
  if (cmd === 'version' || flags.version) { print(SERVER_VERSION); return 0; }
  if (cmd === 'hook') return hookCommand(pos.slice(1), flags);

  const { configPath, loadCfg } = ctxFor(flags);
  const installCtx = (cfg, dryRun) => ({
    home: clientHome({ home: flags.home }), node: process.execPath, cli: CLI_PATH, configPath,
    serverName: cfg.mcp.serverName, backupDir: path.join(path.dirname(configPath), 'backups'), dryRun
  });
  const pickClients = cfg => {
    const v = flags.client;
    if (v === 'all') return CLIENT_NAMES;
    if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
    const enabled = CLIENT_NAMES.filter(c => cfg.clients[c]?.enabled);
    if (!enabled.length) throw new VymemError('INVALID_ARGUMENTS', 'No clients selected. Pass --client claude,codex,antigravity (or all), or enable clients with vymem init --clients.');
    return enabled;
  };

  switch (cmd) {
    case 'init': {
      const clients = typeof flags.clients === 'string' ? flags.clients.split(',').map(s => s.trim()).filter(Boolean) : [];
      const r = initVault({ vaultPath: need(flags, 'vault'), configPath, clients, workspaces: flags.workspace || [] });
      print(flags.json ? r : [`VYMEM initialised.`, `  config : ${r.configPath}`, `  vault  : ${r.vault}${r.existing_obsidian_vault ? ' (existing Obsidian vault; .obsidian untouched)' : ''}`,
        `  created: ${r.created.length ? r.created.join(', ') : 'nothing (already set up)'}`, `  clients: ${r.clients.join(', ') || 'none selected'}`, '', 'Next: vymem install --client <name> --mcp --yes   then   vymem doctor'].join('\n'));
      return 0;
    }
    case 'install': case 'uninstall': {
      const cfg = loadCfg();
      const names = pickClients(cfg);
      const remove = cmd === 'uninstall';
      const mcp = remove ? true : flags.mcp === true || flags.hooks !== true; // default: MCP registration only
      const hooks = remove ? true : flags.hooks === true;
      const dry = flags.yes !== true;
      const results = applyClients(names, installCtx(cfg, dry), { mcp, hooks, remove });
      if (!dry) {
        const manifestPath = path.join(path.dirname(configPath), 'install-manifest.json');
        const manifest = readJson(manifestPath, { events: [] });
        manifest.events.push({ at: new Date().toISOString(), action: cmd, results });
        writeJsonAtomic(manifestPath, manifest);
        if (!remove && hooks) { setByPath(cfg, 'hooks.enabled', true); saveConfig(configPath, cfg); }
        if (remove) { setByPath(cfg, 'hooks.enabled', false); saveConfig(configPath, cfg); }
        if (remove && flags['purge-config']) { fs.rmSync(configPath, { force: true }); fs.rmSync(manifestPath, { force: true }); }
      }
      if (flags.json) { print({ dry_run: dry, results }); return 0; }
      print([dry ? 'DRY RUN - no files were changed. Re-run with --yes to apply:' : `${remove ? 'Uninstalled' : 'Installed'}:`,
        ...results.flatMap(r => r.steps.map(s => `  ${r.client} ${s.kind}: ${s.file} - ${s.changed ? (dry ? 'would change' : 'changed' + (s.backup ? ` (backup: ${s.backup})` : '')) : 'already up to date'}`)),
        ...(remove ? ['Your vault and notes were not touched.'] : [])].join('\n'));
      return 0;
    }
    case 'doctor': {
      const cfgLoader = loadCfg;
      let cfgForHome = null; try { cfgForHome = loadCfg(); } catch { /* reported by doctor */ }
      const checks = await doctor(cfgLoader, { ...(cfgForHome ? installCtx(cfgForHome, true) : { home: clientHome({ home: flags.home }), node: process.execPath, cli: CLI_PATH, configPath, serverName: 'vymem' }) });
      if (flags.json) print(checks);
      else {
        const icon = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', info: 'INFO' };
        print(checks.map(c => `[${icon[c.level]}] ${c.name}${c.detail ? ' - ' + c.detail : ''}`).join('\n'));
      }
      return checks.some(c => c.level === 'fail') ? 1 : 0;
    }
    case 'status': {
      const cfg = loadCfg(); const vault = new Vault(cfg);
      print(statusReport(vault, cfg, installCtx(cfg, true)));
      return 0;
    }
    case 'mcp': {
      const cfg = loadCfg(); const vault = new Vault(cfg);
      const permission = typeof flags.permission === 'string' ? flags.permission : cfg.mcp.permission;
      serveStdio(createRequestHandler({ vault, cfg, permission }));
      return 'keep-alive';
    }
    case 'search': {
      const cfg = loadCfg(); const vault = new Vault(cfg);
      print(knowledgeSearch(vault, { query: pos.slice(1).join(' '), limit: flags.limit ? Number(flags.limit) : undefined, folders: flags.folder ? [String(flags.folder)] : undefined, entity_type: flags['entity-type'] }, cfg));
      return 0;
    }
    case 'context': {
      const cfg = loadCfg(); const vault = new Vault(cfg);
      print(getProjectContext(vault, pos[1] ? { project: pos.slice(1).join(' ') } : { cwd: flags.cwd || process.cwd() }));
      return 0;
    }
    case 'project': {
      const cfg = loadCfg(); const vault = new Vault(cfg);
      const sub = pos[1];
      if (sub === 'add') { print(addProject(vault, { name: pos.slice(2).join(' '), path: flags.path, repository_url: flags['repository-url'], summary: flags.summary, tech: flags.tech })); return 0; }
      if (sub === 'list') { print(listProjects(vault).map(p => ({ project: p.stem, path: p.rel, lifecycle: p.fields.lifecycle || null, local_path: p.fields.local_path || null }))); return 0; }
      if (sub === 'identify') { const r = resolveWorkspace(vault, flags.cwd || process.cwd()); print({ repository_root: r.repo?.root || null, branch: r.git?.branch || null, head: r.git?.head || null, project: r.project, in_vault: r.inVault }); return 0; }
      throw new VymemError('INVALID_ARGUMENTS', 'Usage: vymem project add <name> | list | identify');
    }
    case 'handoffs': {
      const cfg = loadCfg(); const vault = new Vault(cfg);
      const pf = flags.project ? String(flags.project).toLowerCase() : null;
      print(listHandoffRecords(vault).filter(h => !pf || String(h.fields.project_identifier).toLowerCase() === pf)
        .map(h => ({ record_id: h.fields.record_id, path: h.rel, project: h.fields.project_identifier, agent: h.fields.originating_agent, approved_by_owner: h.fields.approved_by_owner === true, confidence: h.fields.knowledge_confidence, at: h.fields.handoff_timestamp })));
      return 0;
    }
    case 'freshness': {
      const cfg = loadCfg(); const vault = new Vault(cfg);
      if (!cfg.workspaces.roots.length) throw new VymemError('NO_WORKSPACE_ROOTS', 'No workspace roots configured. Use: vymem init --vault <dir> --workspace <dir>');
      print(scanWorkspaces(vault, cfg).map(r => ({ repository: r.name, project: r.project, freshness: r.freshness, signals: r.signals, dirty_files: r.dirty_files, head: r.head })));
      return 0;
    }
    case 'approve': {
      needYes(flags, 'Approving a record'); const cfg = loadCfg(); const vault = new Vault(cfg);
      print(approveRecord(vault, { record_id: pos[1], approved_by: need(flags, 'by') })); return 0;
    }
    case 'proposals': {
      const cfg = loadCfg(); const vault = new Vault(cfg);
      const sub = pos[1] || 'list';
      if (sub === 'list') { print(listProposals(vault, { status: flags.all ? 'all' : 'pending_approval' })); return 0; }
      if (sub === 'show') { print(vault.read(`${cfg.vault.folders.proposals}/${String(pos[2]).replace(/\.md$/, '')}.md`).raw); return 0; }
      needYes(flags, `Proposal ${sub}`);
      if (sub === 'apply') { print(applyProposal(vault, { proposal_id: pos[2], approved_by: need(flags, 'by'), expected_target_sha256: flags['expected-sha'] })); return 0; }
      if (sub === 'reject') { print(rejectProposal(vault, { proposal_id: pos[2], rejected_by: need(flags, 'by'), reason: flags.reason })); return 0; }
      throw new VymemError('INVALID_ARGUMENTS', 'Usage: vymem proposals list|show|apply|reject');
    }
    case 'rollback': {
      needYes(flags, 'Rollback'); const cfg = loadCfg(); const vault = new Vault(cfg);
      need(flags, 'by'); const r = vault.rollback(need(flags, 'backup'), need(flags, 'target'));
      vault.audit({ action: 'SAFE_ROLLBACK', approved_by: String(flags.by), ...r }); print(r); return 0;
    }
    case 'sentinel': {
      const cfg = loadCfg(); const vault = new Vault(cfg);
      const sub = pos[1] || 'status';
      if (sub === 'run') { print(runSentinel(vault, cfg)); return 0; }
      if (sub === 'watch') {
        const every = Math.max(1, Number(flags.interval || cfg.sentinel.intervalMinutes)) * 60000;
        const tick = () => { try { print(runSentinel(vault, cfg)); } catch (e) { console.error(JSON.stringify(errorPayload(e))); } };
        tick(); setInterval(tick, every);
        return 'keep-alive';
      }
      print({ enabled: cfg.sentinel.enabled, intervalMinutes: cfg.sentinel.intervalMinutes, workspaceRoots: cfg.workspaces.roots.length, last_snapshot: (() => { try { return vault.read(`${cfg.vault.folders.inbox}/sentinel/workspace-snapshot.md`).rel; } catch { return null; } })() });
      return 0;
    }
    case 'config': {
      const sub = pos[1];
      if (sub === 'path') { print(configPath); return 0; }
      const cfg = loadCfg();
      if (sub === 'get') { print(pos[2] ? getByPath(cfg, pos[2]) : cfg); return 0; }
      if (sub === 'set') {
        let value = pos.slice(3).join(' ');
        try { value = JSON.parse(value); } catch { /* keep string */ }
        setByPath(cfg, pos[2], value); saveConfig(configPath, cfg); print({ set: pos[2], value }); return 0;
      }
      throw new VymemError('INVALID_ARGUMENTS', 'Usage: vymem config path | get [key] | set <key> <json-value>');
    }
    case 'prune': {
      const cfg = loadCfg(); const vault = new Vault(cfg);
      print(prune(vault, cfg, { apply: flags.yes === true })); return 0;
    }
    default:
      throw new VymemError('UNKNOWN_COMMAND', `Unknown command '${cmd}'. Run 'vymem help'.`);
  }
}

export async function run(argv) {
  try {
    const code = await main(argv);
    if (code === 'keep-alive') return;
    process.exitCode = code;
  } catch (err) {
    console.error(JSON.stringify(errorPayload(err), null, 2));
    process.exitCode = err instanceof VymemError ? 1 : 2;
  }
}
