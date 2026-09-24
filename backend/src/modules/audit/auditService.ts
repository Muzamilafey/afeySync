import type { Request } from 'express';
import { meta } from '../../models/meta';
import type { TenantModels } from '../../models/tenant';
import { logger } from '../../utils/logger';

export interface AuditEntry {
  action: string;
  resource?: string;
  resourceId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  result?: 'success' | 'failure' | 'denied';
}

const SENSITIVE = /password|secret|token|apikey|api_key|passkey|hash/i;

/** Remove credentials and cap size before persisting audit snapshots. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object' && !(value instanceof Date)) {
    const src = typeof (value as { toObject?: () => unknown }).toObject === 'function' ? (value as { toObject: () => object }).toObject() : value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src as object)) out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

const device = (req: Request) => (req.get('user-agent') ?? '').slice(0, 250);

/** Tenant audit trail (append-only, stored inside the tenant database). */
export async function audit(req: Request, entry: AuditEntry, models?: TenantModels) {
  const m = models ?? req.tenant?.models;
  if (!m) return;
  try {
    await m.AuditLog.create({
      userId: req.user?.id,
      userName: req.user?.name,
      actorType: req.user?.kind === 'support' ? 'support' : req.user ? 'user' : 'system',
      branchId: req.branch?.id,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? undefined,
      oldValue: redact(entry.oldValue),
      newValue: redact(entry.newValue),
      result: entry.result ?? 'success',
      ip: req.ip,
      device: device(req),
      requestId: req.requestId,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write tenant audit log');
  }
}

/** Platform audit trail (owner portal actions). */
export async function platformAudit(req: Request | null, entry: AuditEntry & { tenantId?: string }) {
  try {
    await meta().PlatformAuditLog.create({
      actorId: req?.platformUser?.id,
      actorEmail: req?.platformUser?.email,
      actorType: req?.platformUser ? 'platform_user' : 'system',
      tenantId: entry.tenantId,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? undefined,
      oldValue: redact(entry.oldValue),
      newValue: redact(entry.newValue),
      result: entry.result ?? 'success',
      ip: req?.ip,
      device: req ? device(req) : undefined,
      requestId: req?.requestId,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write platform audit log');
  }
}
