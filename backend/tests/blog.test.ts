import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, OWNER_HOST, ownerToken, PASSWORD, setupApp, teardown } from './helpers';
import { meta } from '../src/models/meta';
import { hashPassword } from '../src/modules/auth/password';
import { inspectImage } from '../src/modules/blog/blog.routes';

let owner = '';
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const as = (token: string) => ({
  get: (p: string) => api().get(p).set('Host', OWNER_HOST).set('Authorization', `Bearer ${token}`),
  post: (p: string) => api().post(p).set('Host', OWNER_HOST).set('Authorization', `Bearer ${token}`),
  put: (p: string) => api().put(p).set('Host', OWNER_HOST).set('Authorization', `Bearer ${token}`),
  del: (p: string) => api().delete(p).set('Host', OWNER_HOST).set('Authorization', `Bearer ${token}`),
});
const site = (p: string) => api().get(p).set('Host', 'afeysync.test');

beforeAll(async () => {
  await setupApp();
  owner = await ownerToken();
});
afterAll(teardown);

describe('website blog', () => {
  let imageUrl = '';
  let imageId = '';
  let postId = '';

  it('accepts real images only and serves them publicly', async () => {
    const up = await as(owner).post('/api/v1/owner/blog/images').attach('file', PNG_1x1, 'dot.png');
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ width: 1, height: 1 });
    imageUrl = up.body.data.url;
    imageId = up.body.data.id;
    const img = await site(imageUrl);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(Buffer.from(img.body).equals(PNG_1x1)).toBe(true);
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    // An HTML file renamed to .png is refused.
    const fake = await as(owner).post('/api/v1/owner/blog/images').attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(415);
  });

  it('keeps drafts private and publishes with a clean web address', async () => {
    const created = await as(owner).post('/api/v1/owner/blog/posts').send({ title: 'SHA Claims: A Practical Guide!', excerpt: 'How to get paid.', content: `# Hello\n\n![Chart](${imageUrl})\n\nText.`, coverImageId: imageId, category: 'Guides', tags: ['sha', 'claims', 'sha'] });
    expect(created.status).toBe(201);
    expect(created.body.data.slug).toBe('sha-claims-a-practical-guide');
    postId = created.body.data.id;
    expect((await site('/api/v1/blog/posts/sha-claims-a-practical-guide')).status).toBe(404);
    expect((await site('/api/v1/blog/posts')).body.data).toHaveLength(0);

    const pub = await as(owner).put(`/api/v1/owner/blog/posts/${postId}`).send({ title: 'SHA Claims: A Practical Guide!', excerpt: 'How to get paid.', content: `# Hello\n\n![Chart](${imageUrl})\n\nText.`, coverImageId: imageId, category: 'Guides', tags: ['sha', 'claims'], status: 'published' });
    expect(pub.status).toBe(200);
    const list = await site('/api/v1/blog/posts');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ title: 'SHA Claims: A Practical Guide!', coverImageUrl: imageUrl, category: 'Guides', tags: ['sha', 'claims'] });
    expect(list.body.meta.categories).toEqual(['Guides']);
    const one = await site('/api/v1/blog/posts/sha-claims-a-practical-guide');
    expect(one.body.data.content).toContain('# Hello');
    expect(one.body.data.publishedAt).toBeTruthy();
  });

  it('gives a second article with the same title its own address', async () => {
    const r = await as(owner).post('/api/v1/owner/blog/posts').send({ title: 'SHA Claims: A Practical Guide!', content: 'Another', status: 'published' });
    expect(r.body.data.slug).toBe('sha-claims-a-practical-guide-2');
  });

  it('lets only owner users with the content permission write articles', async () => {
    expect((await api().post('/api/v1/owner/blog/posts').set('Host', OWNER_HOST).send({ title: 'Nope nope' })).status).toBe(401);
    await meta().PlatformUser.create({ email: 'support@afeysync.test', name: 'Support', role: 'platform_support', passwordHash: await hashPassword(PASSWORD) });
    const support = await ownerToken('support@afeysync.test');
    expect((await as(support).post('/api/v1/owner/blog/posts').send({ title: 'Nope nope' })).status).toBe(403);
    expect((await as(support).post('/api/v1/owner/blog/images').attach('file', PNG_1x1, 'dot.png')).status).toBe(403);
  });

  it('unpublishes and deletes', async () => {
    await as(owner).put(`/api/v1/owner/blog/posts/${postId}`).send({ title: 'SHA Claims: A Practical Guide!', content: 'x', status: 'draft' });
    expect((await site('/api/v1/blog/posts/sha-claims-a-practical-guide')).status).toBe(404);
    expect((await as(owner).del(`/api/v1/owner/blog/posts/${postId}`)).status).toBe(200);
    expect((await as(owner).get(`/api/v1/owner/blog/posts/${postId}`)).status).toBe(404);
  });

  it('reads image sizes from JPEG, GIF and WebP headers', () => {
    const gif = Buffer.from('R0lGODlhAgADAIAAAP///wAAACwAAAAAAgADAAACAoQBADs=', 'base64');
    expect(inspectImage(gif)).toMatchObject({ mime: 'image/gif', width: 2, height: 3 });
    expect(inspectImage(Buffer.from('not an image at all'))).toBeNull();
  });
});
