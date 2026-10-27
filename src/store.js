import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from './seed.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.DOST_DB_FILE ? path.resolve(process.env.DOST_DB_FILE) : path.join(ROOT, 'data', 'db.json');
// DOST_MEMORY=1 keeps everything in memory (used by the eval harness so it never touches live data).
const MEMORY = process.env.DOST_MEMORY === '1';
let db, timer;

export function load() {
  try { if (MEMORY) throw 0; db = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { db = seed(); flush(); }
  // Running missions cannot resume mid-flight; ones parked on an approval stay decidable (see agent.decide).
  db.approvals ||= [];
  const parked = new Set(db.approvals.map(a => a.missionId));
  for (const m of db.missions) if (m.status === 'running' || (m.status === 'waiting' && !parked.has(m.id))) m.status = 'interrupted';
  for (const a of db.approvals) a.resumed = true;
  return db;
}

export function reset() { db = seed(); flush(); return db; }
export const getDb = () => db;
export function save() { clearTimeout(timer); timer = setTimeout(flush, 250); }
// Write-then-rename is atomic, so a crash mid-write never leaves a truncated db.json.
export function flush() {
  clearTimeout(timer);
  if (MEMORY || !db) return;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
export const uid = p => `${p}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
