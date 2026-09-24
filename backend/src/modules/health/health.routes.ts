import { Router } from 'express';
import mongoose from 'mongoose';
import { h } from '../../utils/asyncHandler';
import { getMetaConn } from '../../db/connections';
import { meta, PROVIDERS } from '../../models/meta';

export function getConnectionStats() {
  const conn = getMetaConn();
  return { tenantConnectionsCached: Object.keys((conn as unknown as { otherDbs?: object }).otherDbs ?? {}).length, readyState: conn.readyState };
}

const router = Router();

router.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'afeysync-api', time: new Date().toISOString(), uptimeSeconds: Math.round(process.uptime()) });
});

router.get(
  '/database',
  h(async (_req, res) => {
    const started = Date.now();
    try {
      await getMetaConn().db!.admin().ping();
      res.json({ status: 'ok', meta: { pingMs: Date.now() - started, state: mongoose.STATES[getMetaConn().readyState] } });
    } catch {
      res.status(503).json({ status: 'error', meta: { state: 'unreachable' } });
    }
  }),
);

/** Integration health summary — status only, never credentials or configuration values. */
router.get(
  '/integrations',
  h(async (_req, res) => {
    const configs = await meta().IntegrationConfig.find({ scope: 'platform' }).select('provider enabled health.status health.lastSuccessAt health.lastFailureAt').lean();
    res.json({
      status: 'ok',
      integrations: PROVIDERS.filter((p) => p !== 'storage').map((p) => {
        const c = configs.find((x) => x.provider === p);
        return { provider: p, enabled: c?.enabled ?? false, status: c?.enabled ? (c.health?.status ?? 'unknown') : 'disabled' };
      }),
    });
  }),
);

export default router;
