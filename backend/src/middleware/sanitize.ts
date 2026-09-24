import type { NextFunction, Request, Response } from 'express';

/** Strip keys beginning with `$` or containing `.` to prevent MongoDB operator injection. */
function clean(value: unknown, depth = 0): unknown {
  if (depth > 20) return undefined;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = clean(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
  if (req.body) req.body = clean(req.body);
  // Express 5: req.query is a getter; redefine with a sanitized copy.
  const q = clean({ ...(req.query as object) });
  Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true });
  // Query-string arrays/objects are not accepted anywhere: collapse to strings.
  for (const [k, v] of Object.entries(q as Record<string, unknown>)) {
    if (typeof v !== 'string') (q as Record<string, unknown>)[k] = Array.isArray(v) ? String(v[0] ?? '') : undefined;
  }
  next();
}
