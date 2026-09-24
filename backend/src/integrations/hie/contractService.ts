import { meta } from '../../models/meta';
import { AppError } from '../../utils/errors';
import { DEFAULT_HIE_CONTRACT_VERSION, DEFAULT_HIE_OPERATIONS, type ContractOperation } from './contract';

const cache = new Map<string, { ops: Map<string, ContractOperation>; exp: number }>();

export function invalidateContractCache() {
  cache.clear();
}

/** Seed the default HIE contract for both SHA and DHA providers if none exists. */
export async function seedHieContracts() {
  const { IntegrationContract } = meta();
  for (const provider of ['dha', 'sha'] as const) {
    if (await IntegrationContract.exists({ provider, active: true })) continue;
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
