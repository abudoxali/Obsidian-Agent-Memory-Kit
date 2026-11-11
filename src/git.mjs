// Read-only git helpers. VYMEM never runs a mutating git command.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';

export function gitRead(cwd, args, timeoutMs = 5000) {
  try {
    return cp.execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch { return null; }
}

export function gitAvailable() {
  return gitRead(process.cwd(), ['--version']) !== null;
}

// Walk up from cwd to find a repository root. Supports linked worktrees (.git file).
export function findRepoRoot(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const dotGit = path.join(dir, '.git');
    if (fs.existsSync(dotGit)) {
      let mainRoot = dir;
      try {
        if (fs.statSync(dotGit).isFile()) {
          const m = fs.readFileSync(dotGit, 'utf8').match(/gitdir:\s*(.+)/);
          if (m) {
            const gitdir = path.resolve(dir, m[1].trim());
            const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
            const i = gitdir.indexOf(marker);
            if (i > 0) mainRoot = gitdir.slice(0, i);
          }
        }
      } catch { /* keep dir */ }
      return { root: dir, mainRoot };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readGitState(root) {
  const head = gitRead(root, ['rev-parse', 'HEAD']);
  const branch = gitRead(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const remote = gitRead(root, ['config', '--get', 'remote.origin.url']);
  return { head, branch, remote };
}

// path -> "state|size:mtimeMs" for every changed/untracked file; lets us diff a session start vs. end.
export function dirtySnapshot(root) {
  const out = gitRead(root, ['status', '--porcelain=v1', '-uall'], 8000);
  if (out === null) return null;
  const snap = {};
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const state = line.slice(0, 2).trim() || '?';
    let p = line.slice(3);
    if (p.includes(' -> ')) p = p.split(' -> ').pop();
    p = p.replace(/^"|"$/g, '');
    let sig = '0:0';
    try { const st = fs.statSync(path.join(root, p)); sig = `${st.size}:${Math.round(st.mtimeMs)}`; } catch { /* deleted */ }
    snap[p] = `${state}|${sig}`;
  }
  return snap;
}

export function normRepoUrl(u) {
  return String(u || '').trim().toLowerCase()
    .replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@/, 'https://')
    .replace(/\.git$/, '').replace(/\/+$/, '');
}
