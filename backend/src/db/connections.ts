import mongoose, { type Connection } from 'mongoose';
import { env } from '../config/env';
import { logger } from '../utils/logger';

mongoose.set('strictQuery', true);
// Mongo-injection hardening is done at the edge (middleware/sanitize.ts strips `$`/`.` keys) and by zod schemas.

let metaConn: Connection | null = null;
let tenantBaseConn: Connection | null = null;

export async function connectMeta(uri = env.MONGO_META_URI): Promise<Connection> {
  if (metaConn) return metaConn;
  metaConn = mongoose.createConnection(uri, { maxPoolSize: 50, serverSelectionTimeoutMS: 10000 });
  await metaConn.asPromise();
  logger.info({ db: metaConn.name }, 'Connected to meta database');
  if (env.MONGO_TENANT_URI) {
    tenantBaseConn = mongoose.createConnection(env.MONGO_TENANT_URI, { maxPoolSize: 100 });
    await tenantBaseConn.asPromise();
  } else {
    tenantBaseConn = metaConn;
  }
  return metaConn;
}

export function getMetaConn(): Connection {
  if (!metaConn) throw new Error('Meta database not connected');
  return metaConn;
}

export function getTenantBaseConn(): Connection {
  if (!tenantBaseConn) throw new Error('Tenant base connection not ready');
  return tenantBaseConn;
}

export async function disconnectAll() {
  if (tenantBaseConn && tenantBaseConn !== metaConn) await tenantBaseConn.close();
  if (metaConn) await metaConn.close();
  metaConn = null;
  tenantBaseConn = null;
}
