import type { Types } from 'mongoose';
import type { TenantModels } from '../../models/tenant';
import { AppError } from '../../utils/errors';

type Id = string | Types.ObjectId;

export interface Allocation { batchId: Types.ObjectId; batchNumber: string; expiryDate: Date; quantity: number; unitCost: number }

/**
 * First-Expiry-First-Out allocation with atomic, conditional decrements (no negative stock, safe under
 * concurrent dispensing). Expired batches are never allocated. On a partial failure, already-taken
 * quantities are returned so stock stays consistent.
 */
export async function allocateFefo(m: TenantModels, input: { itemId: Id; locationId: Id; quantity: number }): Promise<Allocation[]> {
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const batches = await m.Batch.find({ itemId: input.itemId, locationId: input.locationId, quantity: { $gt: 0 }, expiryDate: { $gte: today } }).sort({ expiryDate: 1, createdAt: 1 }).lean();
  const available = batches.reduce((s, b) => s + b.quantity, 0);
  if (available < input.quantity) throw new AppError(422, 'INSUFFICIENT_STOCK', `Only ${available} unit(s) in stock (non-expired) at this location`, { available });
  let remaining = input.quantity;
  const taken: Allocation[] = [];
  try {
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(b.quantity, remaining);
      const r = await m.Batch.updateOne({ _id: b._id, quantity: { $gte: take } }, { $inc: { quantity: -take } });
      if (r.modifiedCount !== 1) continue; // raced with another dispense; try next batch
      taken.push({ batchId: b._id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, quantity: take, unitCost: b.unitCost ?? 0 });
      remaining -= take;
    }
    if (remaining > 0) throw new AppError(409, 'STOCK_CHANGED', 'Stock changed while dispensing; please retry');
  } catch (err) {
    for (const t of taken) await m.Batch.updateOne({ _id: t.batchId }, { $inc: { quantity: t.quantity } });
    throw err;
  }
  return taken;
}

export async function stockOnHand(m: TenantModels, filter: { locationIds?: Id[]; itemIds?: Id[] }) {
  const match: Record<string, unknown> = { quantity: { $gt: 0 } };
  if (filter.locationIds) match.locationId = { $in: filter.locationIds };
  if (filter.itemIds) match.itemId = { $in: filter.itemIds };
  const rows = await m.Batch.find(match).select('itemId quantity expiryDate unitCost').lean();
  const today = new Date();
  const map = new Map<string, { onHand: number; usable: number; expired: number; value: number; nearestExpiry?: Date }>();
  for (const b of rows) {
    const k = String(b.itemId);
    const e = map.get(k) ?? { onHand: 0, usable: 0, expired: 0, value: 0 };
    e.onHand += b.quantity;
    if (b.expiryDate < today) e.expired += b.quantity;
    else {
      e.usable += b.quantity;
      if (!e.nearestExpiry || b.expiryDate < e.nearestExpiry) e.nearestExpiry = b.expiryDate;
    }
    e.value += b.quantity * (b.unitCost ?? 0);
    map.set(k, e);
  }
  return map;
}
