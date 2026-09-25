import { meta } from '../../models/meta';
import { AppError } from '../../utils/errors';
import { DEFAULT_HIE_CONTRACT_VERSION, DEFAULT_HIE_OPERATIONS, type ContractOperation } from './contract';

const cache = new Map<string, { ops: Map<string, ContractOperation>; exp: number }>();

export function invalidateContractCache() {
  cache.clear();
}

/**
 * Seed the default HIE contract for both providers, or upgrade an existing one: operations that are new in the
 * default set are added, and default paths are filled in only where the owner has not configured a path.
 * Paths the owner entered are never overwritten.
 */
export async function seedHieContracts() {
  const { IntegrationContract } = meta();
  for (const provider of ['dha', 'sha'] as const) {
    const existing = await IntegrationContract.find({ provider, active: true });
    for (const contract of existing) {
      let changed = false;
      const ops = contract.supportedOperations as unknown as ContractOperation[];
      for (const def of DEFAULT_HIE_OPERATIONS) {
        const cur = ops.find((o) => o.key === def.key);
        if (!cur) {
          (contract.supportedOperations as unknown as ContractOperation[]).push({ ...def });
          changed = true;
        } else if (!cur.path && def.path) {
          Object.assign(cur, { path: def.path, method: def.method, contentType: def.contentType, verification: def.verification, documentationRef: def.documentationRef, requiresFacilityHeaders: def.requiresFacilityHeaders, idempotent: def.idempotent });
          changed = true;
        } else if (cur.verification === undefined && def.verification === 'documented' && cur.path === def.path) {
          cur.verification = 'documented';
          changed = true;
        }
      }
      if (changed) {
        contract.markModified('supportedOperations');
        await contract.save();
        invalidateContractCache();
      }
    }
    if (existing.length) continue;
    await IntegrationContract.create({
      provider,
      environment: 'uat',
      contractVersion: DEFAULT_HIE_CONTRACT_VERSION,
      documentationURL: 'https://hie-docs.dha.go.ke/',
      supportedOperations: DEFAULT_HIE_OPERATIONS,
      active: true,
    });
  }
}

export async function getOperation(provider: 'sha' | 'dha', environment: string, key: string): Promise<ContractOperation> {
  const cacheKey = `${provider}:${environment}`;
  let entry = cache.get(cacheKey);
  if (!entry || entry.exp < Date.now()) {
    const { IntegrationContract } = meta();
    const contract =
      (await IntegrationContract.findOne({ provider, environment, active: true }).sort({ updatedAt: -1 }).lean()) ??
      (await IntegrationContract.findOne({ provider, active: true }).sort({ updatedAt: -1 }).lean());
    const ops = new Map<string, ContractOperation>();
    for (const op of (contract?.supportedOperations ?? DEFAULT_HIE_OPERATIONS) as ContractOperation[]) ops.set(op.key, op);
    entry = { ops, exp: Date.now() + 30_000 };
    cache.set(cacheKey, entry);
  }
  const op = entry.ops.get(key);
  if (!op) throw new AppError(501, 'INTEGRATION_OPERATION_UNKNOWN', `Operation ${key} is not part of the ${provider.toUpperCase()} contract`);
  if (!op.path) {
    throw new AppError(
      501,
      'INTEGRATION_OPERATION_NOT_CONFIGURED',
      `The HIE operation "${op.description}" has not been configured. The platform owner must enter its endpoint from the current official DHA HIE API catalog (Owner → API Config).`,
    );
  }
  return op;
}
