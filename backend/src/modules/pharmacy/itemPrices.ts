import type { Request } from 'express';
import { badRequest, forbidden } from '../../utils/errors';
import { audit } from '../audit/auditService';

export const billingCodeOf = (i: { code: string; serviceCode?: string | null }) => (i.serviceCode || `RX-${i.code}`).toUpperCase();

/** Keeps the item's billing service (what dispensing charges) in step with the prices entered on the item. */
export async function syncItemPrices(req: Request, item: { _id: unknown; code: string; name: string; strength?: string | null; serviceCode?: string | null }, prices?: Partial<Record<string, number | null>>) {
  if (!prices || !Object.values(prices).some((v) => v !== undefined)) return null;
  if (!req.user!.permissions.has('billing.prices')) throw forbidden('Only users who manage prices (billing.prices) can set selling prices.');
  const m = req.tenant!.models;
  const code = billingCodeOf(item);
  const svc = (await m.ServiceItem.findOne({ code })) ?? new m.ServiceItem({ code, name: `${item.name}${item.strength ? ` ${item.strength}` : ''}`, category: 'pharmacy', prices: [] });
  const before = svc.prices.map((p) => ({ priceList: p.priceList, amount: p.amount }));
  const next = new Map(before.map((p) => [p.priceList, p.amount]));
  for (const [list, amount] of Object.entries(prices)) {
    if (amount === undefined) continue;
    if (amount === null) next.delete(list);
    else next.set(list, amount);
  }
  if (!next.has('cash') && next.size) throw badRequest('Set a cash price: it is the fallback for any list without its own price.');
  svc.set('prices', [...next].map(([priceList, amount]) => ({ priceList, amount })));
  await svc.save();
  await audit(req, { action: 'billing.price_update', resource: 'service', resourceId: code, oldValue: before, newValue: { prices: svc.prices, via: `inventory item ${item.code}` } });
  return svc;
}
