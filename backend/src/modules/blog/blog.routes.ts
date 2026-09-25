import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import { z } from 'zod';
import { h } from '../../utils/asyncHandler';
import { parse, pagination, escapeRegex } from '../../utils/validate';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors';
import { authenticatePlatform, requirePermission } from '../../middleware/auth';
import { meta } from '../../models/meta';
import { platformAudit } from '../audit/auditService';

/**
 * Website articles (afey.co.ke/blog), written in the owner portal.
 *
 * Content is Markdown and the website renders it without ever passing raw HTML to the browser, so an
 * article cannot inject scripts. Images are uploaded here, checked by their content (not by the name
 * or type the browser claims) and served publicly from /api/v1/blog/images/:id.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CONTENT = 100_000;

export const blogSlugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

/** Image type and size from the file's own bytes. Only PNG, JPEG, WebP and GIF are accepted. */
export function inspectImage(buf: Buffer): { mime: string; width?: number; height?: number } | null {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length >= 10 && buf.subarray(0, 6).toString('latin1').match(/^GIF8[79]a$/)) return { mime: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length >= 30 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    const kind = buf.subarray(12, 16).toString('latin1');
    if (kind === 'VP8X') return { mime: 'image/webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { mime: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { mime: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    return { mime: 'image/webp' };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    // Walk the JPEG markers to the frame header for the dimensions.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { mime: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { mime: 'image/jpeg' };
  }
  return null;
}

const readingMinutes = (md: string) => Math.max(1, Math.round(md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').split(/\s+/).filter(Boolean).length / 200));
const imageUrl = (id: unknown) => (id ? `/api/v1/blog/images/${String(id)}` : null);

type PostDoc = { _id: unknown; title: string; slug: string; excerpt?: string | null; content?: string | null; coverImageId?: unknown; coverAlt?: string | null; category?: string | null; tags?: string[]; status?: string | null; publishedAt?: Date | null; seoTitle?: string | null; seoDescription?: string | null; authorName?: string | null; updatedByName?: string | null; createdAt?: Date; updatedAt?: Date };
const summary = (p: PostDoc) => ({ id: String(p._id), title: p.title, slug: p.slug, excerpt: p.excerpt ?? '', coverImageUrl: imageUrl(p.coverImageId), coverAlt: p.coverAlt ?? '', category: p.category ?? null, tags: p.tags ?? [], publishedAt: p.publishedAt ?? null, authorName: p.authorName ?? 'AfeySync', readingMinutes: readingMinutes(p.content ?? '') });
const full = (p: PostDoc) => ({ ...summary(p), content: p.content ?? '', seoTitle: p.seoTitle ?? null, seoDescription: p.seoDescription ?? null, updatedAt: p.updatedAt ?? null });

/* ================================================================== Public (the website) */
export const blogPublicRouter = Router();

blogPublicRouter.get('/blog/posts', h(async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().max(80).optional(), category: z.string().trim().max(60).optional(), tag: z.string().trim().max(40).optional() }), req.query);
  const { page, limit, skip } = pagination(req.query, 24);
  const filter: Record<string, unknown> = { status: 'published', publishedAt: { $lte: new Date() } };
  if (q.category) filter.category = q.category;
  if (q.tag) filter.tags = q.tag;
  if (q.q) filter.$or = [{ title: new RegExp(escapeRegex(q.q), 'i') }, { excerpt: new RegExp(escapeRegex(q.q), 'i') }];
  const { BlogPost } = meta();
  const [items, total, categories] = await Promise.all([
    BlogPost.find(filter).sort({ publishedAt: -1 }).skip(skip).limit(limit).lean(),
    BlogPost.countDocuments(filter),
    BlogPost.distinct('category', { status: 'published', publishedAt: { $lte: new Date() } }),
  ]);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ success: true, data: items.map((p) => summary(p as PostDoc)), meta: { page, limit, total, categories: (categories as (string | null)[]).filter(Boolean).sort() } });
}));

blogPublicRouter.get('/blog/posts/:slug', h(async (req, res) => {
  const slug = String(req.params.slug).toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw notFound('Article');
  const { BlogPost } = meta();
  const post = await BlogPost.findOne({ slug, status: 'published', publishedAt: { $lte: new Date() } }).lean();
  if (!post) throw notFound('Article');
  const related = await BlogPost.find({ _id: { $ne: post._id }, status: 'published', publishedAt: { $lte: new Date() }, ...(post.category ? { category: post.category } : {}) }).sort({ publishedAt: -1 }).limit(3).lean();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ success: true, data: { ...full(post as PostDoc), related: related.map((p) => summary(p as PostDoc)) } });
}));

blogPublicRouter.get('/blog/images/:id', h(async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound('Image');
  const img = await meta().BlogImage.findById(req.params.id).select('+data mimeType sha256').lean();
  if (!img) throw notFound('Image');
  // Images never change once uploaded (a new upload gets a new id), so they can be cached for a long time.
  res.set({ 'Content-Type': img.mimeType, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cross-Origin-Resource-Policy': 'cross-origin', ETag: `"${img.sha256}"` });
  if (req.get('if-none-match') === `"${img.sha256}"`) return res.status(304).end();
  const raw = img.data as unknown as Buffer | { buffer: Buffer };
  const body = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer);
  res.set('Content-Length', String(body.length)).end(body);
}));

/* ================================================================== Owner portal */
export const blogOwnerRouter = Router();
blogOwnerRouter.use(authenticatePlatform, requirePermission('owner.content'));

const optional = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const postSchema = z.object({
  title: z.string().trim().min(3, 'Give the article a title').max(160),
  slug: z.string().trim().toLowerCase().max(80).optional().nullable(),
  excerpt: optional(300),
  content: z.string().max(MAX_CONTENT, 'The article is too long').default(''),
  coverImageId: z.string().regex(/^[0-9a-f]{24}$/).optional().nullable(),
  coverAlt: optional(160),
  category: optional(60),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
  publishedAt: z.coerce.date().optional().nullable(),
  seoTitle: optional(70),
  seoDescription: optional(170),
});

async function uniqueSlug(wanted: string, exceptId?: string) {
  const base = blogSlugify(wanted) || 'article';
  const { BlogPost } = meta();
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base.slice(0, 76)}-${i + 1}`;
    const clash = await BlogPost.findOne({ slug, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select('_id').lean();
    if (!clash) return slug;
  }
  throw conflict('Choose a different web address for this article');
}

async function checkCover(id: string | null | undefined) {
  if (id && !(await meta().BlogImage.exists({ _id: id }))) throw badRequest('The cover image was not found. Upload it again.');
}

blogOwnerRouter.get('/posts', h(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['draft', 'published']).optional(), q: z.string().trim().max(80).optional() }), req.query);
  const { page, limit, skip } = pagination(req.query, 100);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.q) filter.title = new RegExp(escapeRegex(q.q), 'i');
  const { BlogPost } = meta();
  const [items, total] = await Promise.all([BlogPost.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(), BlogPost.countDocuments(filter)]);
  res.json({ success: true, data: items.map((p) => ({ ...summary(p as PostDoc), status: p.status, updatedAt: p.updatedAt, updatedByName: p.updatedByName ?? p.authorName ?? null })), meta: { page, limit, total } });
}));

blogOwnerRouter.get('/posts/:id', h(async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound('Article');
  const post = await meta().BlogPost.findById(req.params.id).lean();
  if (!post) throw notFound('Article');
  res.json({ success: true, data: { ...full(post as PostDoc), status: post.status, coverImageId: post.coverImageId ? String(post.coverImageId) : null } });
}));

const actor = (req: Request) => ({ id: req.platformUser!.id, name: req.platformUser!.name });

blogOwnerRouter.post('/posts', h(async (req, res) => {
  const body = parse(postSchema, req.body);
  await checkCover(body.coverImageId);
  const me = actor(req);
  const post = await meta().BlogPost.create({
    ...body,
    slug: await uniqueSlug(body.slug || body.title),
    tags: [...new Set(body.tags)],
    publishedAt: body.status === 'published' ? body.publishedAt ?? new Date() : body.publishedAt ?? null,
    authorId: me.id,
    authorName: me.name,
    updatedByName: me.name,
  });
  await platformAudit(req, { action: 'blog.create', resource: 'blog_post', resourceId: String(post._id), newValue: { title: body.title, status: body.status } });
  res.status(201).json({ success: true, data: { id: String(post._id), slug: post.slug } });
}));

blogOwnerRouter.put('/posts/:id', h(async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound('Article');
  const body = parse(postSchema, req.body);
  await checkCover(body.coverImageId);
  const { BlogPost } = meta();
  const existing = await BlogPost.findById(req.params.id).lean();
  if (!existing) throw notFound('Article');
  const slug = body.slug && body.slug !== existing.slug ? await uniqueSlug(body.slug, String(existing._id)) : existing.slug;
  // First publication gets today's date unless one was chosen; later edits keep the original date.
  const publishedAt = body.status === 'published' ? body.publishedAt ?? existing.publishedAt ?? new Date() : body.publishedAt ?? existing.publishedAt ?? null;
  await BlogPost.updateOne({ _id: existing._id }, { $set: { ...body, slug, tags: [...new Set(body.tags)], publishedAt, updatedByName: actor(req).name } });
  await platformAudit(req, { action: 'blog.update', resource: 'blog_post', resourceId: String(existing._id), newValue: { title: body.title, status: body.status } });
  res.json({ success: true, data: { id: String(existing._id), slug } });
}));

blogOwnerRouter.delete('/posts/:id', h(async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound('Article');
  const post = await meta().BlogPost.findByIdAndDelete(req.params.id).lean();
  if (!post) throw notFound('Article');
  await platformAudit(req, { action: 'blog.delete', resource: 'blog_post', resourceId: String(post._id), oldValue: { title: post.title } });
  res.json({ success: true, data: { deleted: true } });
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5 } });

blogOwnerRouter.post(
  '/images',
  (req, res, next) => upload.single('file')(req, res, (err: unknown) => (err ? next(err instanceof multer.MulterError ? new AppError(413, 'FILE_TOO_LARGE', 'Images must be 5 MB or smaller') : err) : next())),
  h(async (req, res) => {
    const file = req.file;
    if (!file?.buffer?.length) throw badRequest('Choose an image to upload');
    const info = inspectImage(file.buffer);
    if (!info) throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload a PNG, JPEG, WebP or GIF image');
    const me = actor(req);
    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const img = await meta().BlogImage.create({ mimeType: info.mime, data: file.buffer, sha256, sizeBytes: file.size, width: info.width, height: info.height, originalName: (file.originalname ?? '').slice(0, 120), uploadedBy: me.id, uploadedByName: me.name });
    await platformAudit(req, { action: 'blog.image_upload', resource: 'blog_image', resourceId: String(img._id), newValue: { sizeBytes: file.size, mime: info.mime } });
    res.status(201).json({ success: true, data: { id: String(img._id), url: imageUrl(img._id), width: info.width ?? null, height: info.height ?? null } });
  }),
);
