// Role-based access: operators run Dost, approvers also decide on gated actions and edit policy.
// Tokens come from env; a successful login sets a signed HttpOnly cookie so EventSource and
// download links work without custom headers. With no tokens set, auth is off (local demo only).
import crypto from 'node:crypto';

const TOKENS = { operator: process.env.DOST_OPERATOR_TOKEN || '', approver: process.env.DOST_APPROVER_TOKEN || '' };
export const AUTH_ON = !!(TOKENS.operator || TOKENS.approver);
const PUBLIC_READ = process.env.DOST_PUBLIC_READ === '1';
const SECRET = process.env.DOST_SESSION_SECRET || crypto.createHash('sha256').update(`${TOKENS.operator}|${TOKENS.approver}`).digest('hex');
const COOKIE = 'dost_session';
const TTL_MS = 12 * 36e5;
const RANK = { viewer: 0, operator: 1, approver: 2 };

const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');

export function roleForToken(token) {
  if (!token) return null;
  if (TOKENS.approver && eq(token, TOKENS.approver)) return 'approver';
  if (TOKENS.operator && eq(token, TOKENS.operator)) return 'operator';
  return null;
}

export function issueCookie(res, role) {
  const v = `${role}.${Date.now() + TTL_MS}`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.set('Set-Cookie', `${COOKIE}=${v}.${sign(v)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_MS / 1000}${secure}`);
}

export const clearCookie = res => res.set('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);

function sessionRole(req) {
  const bearer = /^Bearer (.+)$/.exec(req.get('Authorization') || '')?.[1];
  if (bearer) return roleForToken(bearer);
  const raw = (req.get('Cookie') || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const i = raw.lastIndexOf('.'), v = raw.slice(0, i), [role, exp] = v.split('.');
  return i > 0 && eq(raw.slice(i + 1), sign(v)) && Number(exp) > Date.now() && RANK[role] ? role : null;
}

// Attaches req.role; rejects requests below the required role.
export const requireRole = min => (req, res, next) => {
  if (!AUTH_ON) { req.role = 'approver'; return next(); }
  const role = sessionRole(req) || (PUBLIC_READ && req.method === 'GET' ? 'viewer' : null);
  if (!role) return res.status(401).json({ error: 'Sign in required' });
  if (RANK[role] < RANK[min]) return res.status(403).json({ error: `Requires the ${min} role` });
  req.role = role; next();
};
