// Small filesystem helpers: atomic writes, JSON IO, hashing, and a cross-process advisory lock.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
export const shortHash = (text, n = 8) => sha256(String(text)).slice(0, n);

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
}

export function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

export function writeJsonAtomic(file, obj) {
  writeFileAtomic(file, JSON.stringify(obj, null, 2));
}

export function slugify(id, max = 80) {
  return String(id).trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'entry';
}

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleepMs = ms => Atomics.wait(sleeper, 0, 0, ms);

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function acquireLockSync(lockPath, { timeoutMs = 10000, staleMs = 30000 } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, token);
      fs.closeSync(fd);
      return token;
    } catch (err) {
      if (!['EEXIST', 'EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      if (err.code !== 'EEXIST') {
        if (Date.now() > deadline) throw err;
        sleepMs(15 + Math.floor(Math.random() * 25));
        continue;
      }
    }
    try {
      const st = fs.statSync(lockPath);
      const owner = parseInt(String(fs.readFileSync(lockPath, 'utf8')).split(':')[0], 10);
      if (Date.now() - st.mtimeMs > staleMs || (Number.isInteger(owner) && !pidAlive(owner))) {
        try { fs.unlinkSync(lockPath); } catch { /* raced */ }
        continue;
      }
    } catch { continue; }
    if (Date.now() > deadline) {
      const e = new Error(`LOCK_TIMEOUT: could not acquire ${path.basename(lockPath)}`);
      e.code = 'LOCK_TIMEOUT';
      throw e;
    }
    sleepMs(20 + Math.floor(Math.random() * 30));
  }
}

export function releaseLockSync(lockPath, token) {
  try { if (fs.readFileSync(lockPath, 'utf8') === token) fs.unlinkSync(lockPath); } catch { /* already released */ }
}

export function withLockSync(lockPath, fn, opts) {
  const token = acquireLockSync(lockPath, opts);
  try { return fn(); } finally { releaseLockSync(lockPath, token); }
}
