// Policies are plain-language SOPs (Markdown) with machine-readable frontmatter.
// The frontmatter drives the guardrail engine; the body is given to the LLM planner.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './store.js';

const DIR = path.join(ROOT, 'policies');
let cache = {};

function parse(name, raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const params = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    params[k] = v !== '' && !isNaN(v) ? Number(v) : v.includes(',') ? v.split(',').map(s => s.trim()) : v;
  }
  return { name, title: params.title || name, params, body: (m ? m[2] : raw).trim(), raw };
}

export function loadPolicies() {
  cache = {};
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.md'))) {
    const name = f.replace(/\.md$/, '');
    cache[name] = parse(name, fs.readFileSync(path.join(DIR, f), 'utf8'));
  }
  return cache;
}

export const policies = () => cache;
export const P = name => cache[name]?.params || {};

export function savePolicy(name, raw) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid policy name');
  const parsed = parse(name, raw);
  if (!Object.keys(parsed.params).length) throw new Error('Policy needs a frontmatter block (--- key: value ---)');
  fs.writeFileSync(path.join(DIR, `${name}.md`), raw);
  cache[name] = parsed;
  return parsed;
}

export const policyPrompt = () => Object.values(cache).map(p => `## ${p.title}\nParameters: ${JSON.stringify(p.params)}\n${p.body}`).join('\n\n');

loadPolicies();
