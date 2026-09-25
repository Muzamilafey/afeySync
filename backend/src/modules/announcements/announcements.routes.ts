import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse, pagination, escapeRegex } from '../../utils/validate';
import { badRequest, notFound } from '../../utils/errors';
import { authenticatePlatform, authenticateTenant, requirePermission } from '../../middleware/auth';
import { meta } from '../../models/meta';
import { platformAudit } from '../audit/auditService';

/**
 * "What's new": announcements from AfeySync (the owner portal) to facilities. Every signed-in user of a
 * facility sees the announcements meant for all facilities or for theirs, with a count of the ones
 * published since they last looked. Written in Markdown and shown with the website's safe renderer.
 */
export const CATEGORIES = ['feature', 'improvement', 'fix', 'maintenance', 'notice'] as const;
const imageUrl = (id: unknown) => (id ? `/api/v1/blog/images/${String(id)}` : null);

type Doc = { _id: unknown; title: string; body?: string | null; category?: string | null; coverImageId?: unknown; audience?: string | null; tenantIds?: unknown[]; pinned?: boolean | null; status?: string | null; publishedAt?: Date | null; authorName?: string | null; updatedByName?: string | null; updatedAt?: Date };
const view = (a: Doc) => ({ id: String(a._id), title: a.title, body: a.body ?? '', category: a.category ?? 'notice', coverImageUrl: imageUrl(a.coverImageId), pinned: !!a.pinned, publishedAt: a.publishedAt ?? null, authorName: a.authorName ?? 'AfeySync' });

/** Published, due, and meant for this facility. */
const visibleTo = (tenantId: string): Record<string, unknown> => ({
  status: 'published',
  publishedAt: { $lte: new Date() },
  $or: [{ audience: 'all' }, { audience: 'facilities', tenantIds: new Types.ObjectId(tenantId) }],
});

/* ================================================================== Facility users */
export const announcementTenantRouter = Router();
announcementTenantRouter.use(authenticateTenant);

async function seenAt(req: Parameters<typeof authenticateTenant>[0]) {
  if (req.user?.kind !== 'tenant') return null;
  const u = await req.tenant!.models.User.findById(req.user.id).select('announcementsSeenAt').lean();
  return (u as { announcementsSeenAt?: Date } | null)?.announcementsSeenAt ?? null;
}

announcementTenantRouter.get('/', h(async (req, res) => {
  const q = parse(z.object({ category: z.enum(CATEGORIES).optional() }), req.query);
  const { page, limit, skip } = pagination(req.query, 50);
  const filter: Record<string, unknown> = visibleTo(req.tenant!.id);
  if (q.category) filter.category = q.category;
  const { Announcement } = meta();
  const [items, total, seen] = await Promise.all([
    Announcement.find(filter).sort({ pinned: -1, publishedAt: -1 }).skip(skip).limit(limit).lean(),
    Announcement.countDocuments(filter),
    seenAt(req),
  ]);
  res.json({ success: true, data: items.map((a) => ({ ...view(a as Doc), unread: !seen || (a.publishedAt ? a.publishedAt > seen : false) })), meta: { page, limit, total, seenAt: seen } });
}));

announcementTenantRouter.get('/unread-count', h(async (req, res) => {
  const seen = await seenAt(req);
  const filter = visibleTo(req.tenant!.id);
  if (seen) (filter.publishedAt as Record<string, Date>).$gt = seen;
  res.json({ success: true, data: { unread: await meta().Announcement.countDocuments(filter) } });
}));

announcementTenantRouter.post('/seen', h(async (req, res) => {
  if (req.user?.kind === 'tenant') await req.tenant!.models.User.updateOne({ _id: req.user.id }, { $set: { announcementsSeenAt: new Date() } });
  res.json({ success: true, data: { unread: 0 } });
}));

/* ================================================================== Owner portal */
export const announcementOwnerRouter = Router();
announcementOwnerRouter.use(authenticatePlatform, requirePermission('owner.content'));

const schema = z.object({
  title: z.string().trim().min(3, 'Give the announcement a title').max(160),
  body: z.string().max(50_000).default(''),
  category: z.enum(CATEGORIES).default('notice'),
  coverImageId: z.string().regex(/^[0-9a-f]{24}$/).optional().nullable(),
  audience: z.enum(['all', 'facilities']).default('all'),
  tenantIds: z.array(z.string().regex(/^[0-9a-f]{24}$/)).max(1000).default([]),
  pinned: z.boolean().default(false),
  status: z.enum(['draft', 'published']).default('draft'),
  publishedAt: z.coerce.date().optional().nullable(),
});

async function check(body: z.infer<typeof schema>) {
  if (body.coverImageId && !(await meta().BlogImage.exists({ _id: body.coverImageId }))) throw badRequest('The picture was not found. Upload it again.');
  if (body.audience === 'facilities') {
    if (!body.tenantIds.length) throw badRequest('Choose at least one facility, or send it to all facilities');
    const found = await meta().Tenant.countDocuments({ _id: { $in: body.tenantIds } });
    if (found !== new Set(body.tenantIds).size) throw badRequest('One of the chosen facilities was not found');
  }
}

announcementOwnerRouter.get('/', h(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['draft', 'published']).optional(), q: z.string().trim().max(80).optional() }), req.query);
  const { page, limit, skip } = pagination(req.query, 100);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.q) filter.title = new RegExp(escapeRegex(q.q), 'i');
  const { Announcement } = meta();
  const [items, total] = await Promise.all([Announcement.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(), Announcement.countDocuments(filter)]);
  res.json({ success: true, data: items.map((a) => ({ ...view(a as Doc), status: a.status, audience: a.audience, facilities: a.tenantIds?.length ?? 0, updatedAt: a.updatedAt, updatedByName: a.updatedByName ?? a.authorName ?? null })), meta: { page, limit, total } });
}));

announcementOwnerRouter.get('/:id', h(async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound('Announcement');
  const a = await meta().Announcement.findById(req.params.id).lean();
  if (!a) throw notFound('Announcement');
  res.json({ success: true, data: { ...view(a as Doc), status: a.status, audience: a.audience, tenantIds: (a.tenantIds ?? []).map(String), coverImageId: a.coverImageId ? String(a.coverImageId) : null } });
}));

announcementOwnerRouter.post('/', h(async (req, res) => {
  const body = parse(schema, req.body);
  await check(body);
  const me = req.platformUser!;
  const a = await meta().Announcement.create({ ...body, publishedAt: body.status === 'published' ? body.publishedAt ?? new Date() : body.publishedAt ?? null, authorName: me.name, updatedByName: me.name });
  await platformAudit(req, { action: 'announcement.create', resource: 'announcement', resourceId: String(a._id), newValue: { title: body.title, status: body.status, audience: body.audience } });
  res.status(201).json({ success: true, data: { id: String(a._id) } });
}));

announcementOwnerRouter.put('/:id', h(async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound('Announcement');
  const body = parse(schema, req.body);
  await check(body);
  const { Announcement } = meta();
  const existing = await Announcement.findById(req.params.id).lean();
  if (!existing) throw notFound('Announcement');
  const publishedAt = body.status === 'published' ? body.publishedAt ?? existing.publishedAt ?? new Date() : body.publishedAt ?? existing.publishedAt ?? null;
  await Announcement.updateOne({ _id: existing._id }, { $set: { ...body, publishedAt, updatedByName: req.platformUser!.name } });
  await platformAudit(req, { action: 'announcement.update', resource: 'announcement', resourceId: String(existing._id), newValue: { title: body.title, status: body.status, audience: body.audience } });
  res.json({ success: true, data: { id: String(existing._id) } });
}));

announcementOwnerRouter.delete('/:id', h(async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound('Announcement');
  const a = await meta().Announcement.findByIdAndDelete(req.params.id).lean();
  if (!a) throw notFound('Announcement');
  await platformAudit(req, { action: 'announcement.delete', resource: 'announcement', resourceId: String(a._id), oldValue: { title: a.title } });
  res.json({ success: true, data: { deleted: true } });
}));
