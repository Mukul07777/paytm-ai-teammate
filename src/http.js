// Dependency-free HTTP hardening: security headers, per-IP rate limits, request logging.
export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
  });
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// Fixed-window limiter; fine for a single instance (use Redis-backed limits when scaling out).
export function rateLimit({ windowMs = 60000, max = 120 } = {}) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now(), k = req.ip;
    let h = hits.get(k);
    if (!h || h.reset < now) hits.set(k, h = { n: 0, reset: now + windowMs });
    if (++h.n > max) { res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000))); return res.status(429).json({ error: 'Too many requests' }); }
    next();
  };
}

// One JSON line per API request — easy to ship to any log pipeline.
export function requestLog(req, res, next) {
  if (!req.path.startsWith('/api/') || req.path === '/api/events') return next();
  const t = Date.now();
  res.on('finish', () => console.log(JSON.stringify({ t: new Date(t).toISOString(), method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t, role: req.role || null })));
  next();
}
