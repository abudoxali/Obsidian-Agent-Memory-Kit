#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// End-to-end VYMEM demonstration on a SYNTHETIC vault with two fictional projects.
//
// What is real: the vault, the git repositories, the CLI, and two independent MCP gateway processes that
// speak the real MCP protocol over stdio. What is simulated: "Agent A" and "Agent B" are scripted MCP clients,
// NOT Claude Code / Codex / Antigravity sessions. Nothing here reads any personal data.
//
//   node examples/run-demo.mjs [--quiet] [--keep] [--transcript <file>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'vymem.mjs');
const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet');
const keep = argv.includes('--keep');
const tIdx = argv.indexOf('--transcript');
const transcriptFile = tIdx > -1 ? argv[tIdx + 1] : null;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vymem-demo-'));
const vaultDir = path.join(tmp, 'vault');
const ws = path.join(tmp, 'workspace');
const env = { ...process.env, VYMEM_CONFIG_DIR: path.join(tmp, 'cfg'), VYMEM_CLIENT_HOME: path.join(tmp, 'home') };
const configPath = path.join(tmp, 'cfg', 'config.json');

const lines = [];
let passed = 0; let total = 0;
const out = s => { lines.push(s); if (!quiet) console.log(s); };
const check = (label, ok, detail = '') => {
  total++; if (ok) passed++;
  const l = `  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -> ${detail}` : ''}`;
  lines.push(l); if (!quiet || !ok) console.log(l);
};
const step = title => out(`\n== ${title}`);
const sh = (args, opts = {}) => cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, ...opts });
const gitc = (cwd, ...a) => cp.execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Minimal real MCP stdio client (newline-delimited JSON-RPC).
class McpAgent {
  constructor(name) {
    this.name = name; this.id = 0; this.pending = new Map(); this.buf = '';
    this.child = cp.spawn(process.execPath, [CLI, 'mcp', '--config', configPath], { env, stdio: ['pipe', 'pipe', 'inherit'] });
    this.child.stdout.on('data', d => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line); this.pending.get(m.id)?.(m); this.pending.delete(m.id);
      }
    });
  }
  rpc(method, params) {
    const id = ++this.id;
    return new Promise(res => { this.pending.set(id, res); this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  }
  async init() { const r = await this.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: this.name, version: '0' } }); this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); return r; }
  async call(tool, args) { const r = await this.rpc('tools/call', { name: tool, arguments: args }); return { error: r.result.isError ? JSON.parse(r.result.content[0].text).error : null, data: r.result.isError ? null : JSON.parse(r.result.content[0].text) }; }
  close() { this.child.kill(); }
}

function buildWorld() {
  fs.cpSync(path.join(ROOT, 'examples', 'demo-vault'), vaultDir, { recursive: true });
  const repos = { 'orders-api': { files: { 'package.json': '{"name":"orders-api","version":"0.1.0"}\n', 'src/retry.js': 'export async function withRetry(fn, attempts = 3) {\n  let delay = 100;\n  for (let i = 0; i < attempts; i++) {\n    try { return await fn(); } catch (e) { if (i === attempts - 1) throw e; await new Promise(r => setTimeout(r, delay)); delay *= 2; }\n  }\n}\n' } },
    'ledger-web': { files: { 'package.json': '{"name":"ledger-web","version":"1.0.0"}\n', 'src/App.tsx': 'export const App = () => null;\n' } } };
  const heads = {};
  for (const [name, spec] of Object.entries(repos)) {
    const dir = path.join(ws, name); fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    for (const [f, c] of Object.entries(spec.files)) fs.writeFileSync(path.join(dir, f), c);
    gitc(dir, 'init', '-q', '-b', 'main'); gitc(dir, 'add', '-A'); gitc(dir, 'commit', '-q', '-m', 'initial');
    heads[name] = gitc(dir, 'rev-parse', 'HEAD').slice(0, 10);
  }
  const subst = { '{{ORDERS_API_PATH}}': path.join(ws, 'orders-api').replace(/\\/g, '/'), '{{ORDERS_API_HEAD}}': heads['orders-api'], '{{LEDGER_WEB_PATH}}': path.join(ws, 'ledger-web').replace(/\\/g, '/'), '{{LEDGER_WEB_HEAD}}': heads['ledger-web'] };
  for (const f of ['orders-api.md', 'ledger-web.md']) {
    const p = path.join(vaultDir, 'Projects', f); let t = fs.readFileSync(p, 'utf8');
    for (const [k, v] of Object.entries(subst)) t = t.split(k).join(v);
    fs.writeFileSync(p, t);
  }
}

async function main() {
  out('VYMEM demo - synthetic vault, two fictional projects, two scripted MCP agents (real protocol, not real clients)');
  fs.mkdirSync(ws, { recursive: true });
  buildWorld();

  step('1. Initialise VYMEM against the synthetic vault (no private vault is involved)');
  const init = sh(['init', '--vault', vaultDir, '--clients', 'claude,codex', '--workspace', ws]);
  check('vymem init succeeded', init.status === 0, init.stderr.trim().split('\n')[0]);
  const doc = sh(['doctor']);
  check('vymem doctor: MCP handshake passes', /\[PASS\] MCP gateway handshake/.test(doc.stdout));

  step('2. Agent A retrieves project context for orders-api');
  const A = new McpAgent('agent-a'); await A.init();
  const ctxA = await A.call('get_project_context', { cwd: path.join(ws, 'orders-api') });
  check('project identified from the working directory', ctxA.data?.matched_by === 'local_path', `matched_by=${ctxA.data?.matched_by}`);
  check('purpose, blocker and related decision returned', /jitter/i.test(ctxA.data?.intelligence.blockers || '') && ctxA.data.related_decisions.some(d => /idempotency/i.test(d.title)));
  check('repository freshness checked (in sync at recorded commit)', ctxA.data?.source_freshness.freshness_status === 'in_sync_or_not_comparable', ctxA.data?.source_freshness.freshness_status);
  check('no handoffs exist yet', ctxA.data?.related_handoffs.length === 0);

  step('3. Agent A makes a controlled change in the orders-api repository');
  const retry = path.join(ws, 'orders-api', 'src', 'retry.js');
  fs.writeFileSync(retry, fs.readFileSync(retry, 'utf8').replace('delay *= 2;', 'delay *= 2; /* jitter */ delay = Math.round(delay * (0.5 + Math.random() * 0.5));'));
  gitc(path.join(ws, 'orders-api'), 'add', '-A'); gitc(path.join(ws, 'orders-api'), 'commit', '-q', '-m', 'Add jitter to retry backoff');
  const head = gitc(path.join(ws, 'orders-api'), 'rev-parse', '--short', 'HEAD');
  check('change committed in the fictional repository', /^[0-9a-f]{7,}$/.test(head), `HEAD ${head}`);

  step('4. Agent A records an UNAPPROVED evidence-backed handoff');
  const handoff = {
    record_id: 'handoff-orders-api-jitter', category: 'agent_handoff', title: 'orders-api: jitter added to retry backoff',
    body: 'Added full-jitter style randomisation to the retry wrapper after two retry storms.', summary: 'Retry backoff in src/retry.js now applies jitter; idempotency key still TODO.',
    source_system: 'demo_agent_a', source_reference: `git:${head}`, owner_agent: 'Agent A',
    handoff: { project_identifier: 'orders-api', originating_agent: 'Agent A', task_objective: 'Reduce synchronized retries against the payment provider',
      actual_completed_work: 'Edited src/retry.js to randomise the delay between attempts.', source_file_references: ['src/retry.js'],
      verification_evidence: `Committed as ${head}. No automated test exists for retry timing; behaviour not load-tested.`,
      current_blockers: 'Payment requests still lack an idempotency key (see decision note).', suggested_next_action: 'Add an idempotency key derived from the order id, then load-test.',
      knowledge_confidence: 'observed_untested' }
  };
  const w = await A.call('submit_knowledge_entry', handoff);
  check('handoff stored in the AI Inbox', w.data?.status === 'WRITTEN_TO_AI_INBOX', w.data?.path);
  check('handoff is NOT approved', w.data?.approved_by_owner === false && w.data?.verification_status === 'unapproved_agent_handoff');

  step('5. Agent B (separate gateway process) retrieves the previous handoff');
  const B = new McpAgent('agent-b'); await B.init();
  const ctxB = await B.call('get_project_context', { project: 'orders-api' });
  const h = ctxB.data?.related_handoffs?.[0];
  check('Agent B sees Agent A\'s handoff', h?.originating_agent === 'Agent A', h?.path);
  check('it is flagged unapproved / unverified', h?.approved_by_owner === false && h?.knowledge_confidence === 'observed_untested');
  check('repository freshness now reports the vault note as behind HEAD', ctxB.data?.source_freshness.freshness_status === 'potentially_stale', (ctxB.data?.source_freshness.signals || []).join(','));

  step('6. Knowledge search returns relevant records');
  const s = await B.call('knowledge_search', { query: 'retry jitter backoff', limit: 5 });
  const paths = (s.data?.results || []).map(r => r.path);
  check('memory note and handoff are found', paths.includes('Agent Memory/Retry wrappers need jitter.md') && paths.some(p => p.includes('handoff-orders-api-jitter')), paths.join(' | '));
  check('handoff result is marked unverified', s.data?.results.find(r => r.path.includes('handoff-'))?.is_unverified === true);

  step('7. Duplicate updates are prevented');
  const handoffFile = path.join(vaultDir, w.data?.path || 'missing');
  const before = fs.readFileSync(handoffFile, 'utf8');
  const dup = await A.call('submit_knowledge_entry', handoff);
  check('identical resubmission is a no-op', dup.data?.status === 'DEDUPLICATED_NO_OP');
  check('file is byte-identical and no extra files exist', fs.readFileSync(handoffFile, 'utf8') === before && fs.readdirSync(path.dirname(handoffFile)).length === 1);
  const clobber = await B.call('submit_knowledge_entry', { ...handoff, owner_agent: 'Agent B', body: 'rewritten by B', handoff: { ...handoff.handoff, originating_agent: 'Agent B' } });
  check('another agent cannot overwrite it (conflict)', clobber.error?.code === 'CONFLICT_DETECTED', clobber.error?.code);
  const leak = await A.call('submit_knowledge_entry', { ...handoff, record_id: 'leaky', body: 'use key ' + 'sk-' + 'q'.repeat(30) });
  check('credential-like text is rejected', leak.error?.code === 'REJECTED_SECRET_DETECTED', leak.error?.code);

  step('8. Approved and locked canonical records stay protected');
  const lockedProp = await A.call('propose_update', { target_path: 'Projects/ledger-web.md', summary: 'Add pagination note', proposed_content: 'Pagination evaluated.', source_system: 'demo_agent_a', source_reference: 'demo', owner_agent: 'Agent A' });
  check('human_locked project note cannot even receive a proposal', lockedProp.error?.code === 'HUMAN_LOCKED', lockedProp.error?.code);
  const noteBefore = fs.readFileSync(path.join(vaultDir, 'Projects', 'orders-api.md'), 'utf8');
  const prop = await A.call('propose_update', { target_path: 'Projects/orders-api.md', summary: 'Record that jitter was added', proposed_section_heading: 'Retry jitter', proposed_content: 'Jitter added in ' + head + '.', source_system: 'demo_agent_a', source_reference: `git:${head}`, owner_agent: 'Agent A' });
  check('proposal staged; canonical note untouched', prop.data?.status === 'PROPOSAL_STAGED' && fs.readFileSync(path.join(vaultDir, 'Projects', 'orders-api.md'), 'utf8') === noteBefore);
  const tools = (await A.rpc('tools/list', {})).result.tools.map(t => t.name);
  check('no MCP tool can apply a proposal or approve a record', !tools.some(n => /apply|approve/.test(n)), `${tools.length} tools`);
  const ap = sh(['approve', 'handoff-orders-api-jitter', '--by', 'demo-owner', '--yes']);
  check('owner approves the handoff via the local CLI', ap.status === 0, JSON.parse(ap.stdout || '{}').status);
  const rewrite = await A.call('submit_knowledge_entry', { ...handoff, body: 'Agent tries to rewrite the approved record' });
  check('approved record is now protected from agents', rewrite.error?.code === 'HUMAN_LOCKED', rewrite.error?.code);
  const apply = sh(['proposals', 'apply', prop.data.proposal_id, '--by', 'demo-owner', '--yes']);
  check('owner applies the proposal via the local CLI (with backup)', apply.status === 0 && JSON.parse(apply.stdout || '{}').status === 'APPLIED_WITH_BACKUP');
  check('canonical note now contains the approved section', /Retry jitter/.test(fs.readFileSync(path.join(vaultDir, 'Projects', 'orders-api.md'), 'utf8')));

  A.close(); B.close();
  out(`\nDEMO RESULT: ${passed}/${total} checks passed`);
  if (transcriptFile) fs.writeFileSync(transcriptFile, lines.join('\n') + '\n');
  if (quiet) console.log(`DEMO RESULT: ${passed}/${total} checks passed`);
  if (keep) console.log(`kept: ${tmp}`); else fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(passed === total ? 0 : 1);
}
main().catch(e => { console.error(e); try { if (!keep) fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } process.exit(2); });
