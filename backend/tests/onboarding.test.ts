import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, hostOf, OWNER_HOST, ownerToken, setupApp, teardown } from './helpers';
import { meta } from '../src/models/meta';
import { seedPlans } from '../src/modules/plans/planService';

const PW = 'Welcome2Afey!';
let owner: string;

const pub = () => ({ get: (u: string) => api().get(`/api/v1${u}`).set('Host', 'afeysync.test'), post: (u: string) => api().post(`/api/v1${u}`).set('Host', 'afeysync.test') });
const own = (method: 'get' | 'post' | 'put', u: string) => api()[method](`/api/v1/owner/onboarding${u}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);

async function lastCode(to: string) {
  const job = await meta().Job.findOne({ type: 'EMAIL', 'payload.to': to, 'payload.subject': /Confirm your AfeySync/ }).sort({ createdAt: -1, _id: -1 }).lean();
  return /code is (\d{6})/.exec((job!.payload as { text: string }).text)![1];
}

const application = (slug: string, email: string, extra: Record<string, unknown> = {}) => ({
  facility: { name: 'Baraka Medical Centre', facilityType: 'Medical Centre', facilityLevel: 'Level 3', ownership: 'Private', county: 'Nairobi', subCounty: 'Westlands', phone: '0712345678', email: 'info@baraka.test', bedCapacity: 20 },
  slug,
  branches: [{ branchName: 'Westlands Main', branchCode: 'wst' }, { branchName: 'Kilimani', branchCode: 'KLM' }],
  admin: { name: 'Grace Wanjiru', email, phone: '0722000111', jobTitle: 'Administrator', password: PW },
  plan: 'standard',
  interests: ['sha', 'mpesa', 'insurance'],
  acceptTerms: true,
  ...extra,
});

async function applyAndVerify(slug: string, email: string) {
  const a = await pub().post('/onboarding/applications').send(application(slug, email));
  expect(a.status).toBe(201);
  const v = await pub().post('/onboarding/applications/verify').send({ applicationToken: a.body.data.applicationToken, code: await lastCode(email) });
  expect(v.status).toBe(200);
  return { token: a.body.data.applicationToken as string, view: v.body.data };
}

beforeAll(async () => {
  await setupApp();
  await seedPlans();
  owner = await ownerToken();
  await createFacility(owner, 'takenfac');
});
afterAll(teardown);

describe('web address availability', () => {
  it('rejects reserved, taken and malformed addresses and suggests one', async () => {
    expect((await pub().get('/onboarding/slug?slug=owner')).body.data).toMatchObject({ available: false, reason: 'This address is reserved.' });
    const taken = await pub().get('/onboarding/slug?slug=takenfac&name=Taken Fac');
    expect(taken.body.data.available).toBe(false);
    expect(taken.body.data.suggestion).toMatch(/^taken-fac/);
    expect((await pub().get('/onboarding/slug?slug=Bad_Slug')).body.data.available).toBe(false);
    const free = await pub().get('/onboarding/slug?name=Baraka Medical Centre');
    expect(free.body.data).toMatchObject({ slug: 'baraka-medical-centre', available: true, address: 'baraka-medical-centre.afeysync.test' });
  });
});

describe('application and email verification', () => {
  it('validates the application and never stores the password or code in clear', async () => {
    const bad = await pub().post('/onboarding/applications').send({ ...application('baraka', 'grace@baraka.test'), acceptTerms: false, admin: { name: 'G', email: 'x', phone: '1', password: 'short' } });
    expect(bad.status).toBe(400);
    const a = await pub().post('/onboarding/applications').send(application('baraka', 'grace@baraka.test'));
    expect(a.status).toBe(201);
    expect(a.body.data.sentTo).toBe('g***e@baraka.test');
    const raw = await meta().FacilityApplication.findOne({ reference: a.body.data.reference }).select('+admin.passwordHash +verification.codeHash').lean();
    expect(raw!.status).toBe('email_pending');
    expect(raw!.admin!.passwordHash).toMatch(/^\$2/);
    expect(JSON.stringify(raw)).not.toContain(PW);
    expect(JSON.stringify(raw)).not.toContain(await lastCode('grace@baraka.test'));
  });

  it('limits wrong codes and resends, then submits for review', async () => {
    const a = await pub().post('/onboarding/applications').send(application('baraka', 'grace@baraka.test'));
    const token = a.body.data.applicationToken;
    expect((await pub().post('/onboarding/applications/resend').send({ applicationToken: token })).body.error.code).toBe('ONBOARDING_RESEND_TOO_SOON');
    const wrong = await pub().post('/onboarding/applications/verify').send({ applicationToken: token, code: '000000' });
    expect(wrong.body.error.code).toBe('ONBOARDING_CODE_INVALID');
    expect(wrong.body.error.message).toBe('Incorrect code. 4 attempt(s) left.');
    const ok = await pub().post('/onboarding/applications/verify').send({ applicationToken: token, code: await lastCode('grace@baraka.test') });
    expect(ok.body.data).toMatchObject({ status: 'submitted', address: 'baraka.afeysync.test' });
    // the address is now held by the application; a second applicant cannot take it
    expect((await pub().get('/onboarding/slug?slug=baraka')).body.data.available).toBe(false);
    expect((await pub().post('/onboarding/applications').send(application('baraka2', 'grace@baraka.test'))).body.error.code).toBe('APPLICATION_PENDING');
    // the owners are notified
    expect(await meta().Job.exists({ type: 'EMAIL', 'payload.subject': /New facility registration/ })).toBeTruthy();
    expect((await pub().post('/onboarding/applications/status').send({ applicationToken: token })).body.data.status).toBe('submitted');
  });
});

describe('owner review', () => {
  it('approves: provisions the facility, and the admin signs in with the password they chose', async () => {
    const list = await own('get', '/applications?status=submitted');
    expect(list.body.meta.pending).toBe(1);
    const row = list.body.data[0];
    expect(JSON.stringify(row)).not.toMatch(/passwordHash|codeHash|tokenHash/);
    const r = await own('post', `/applications/${row._id}/approve`).send({});
    expect(r.status).toBe(200);
    expect(r.body.data.loginUrl).toMatch(/^http:\/\/baraka\.afeysync\.test(:\d+)?\/login$/);
    const login = await api().post('/api/v1/auth/login').set('Host', hostOf('baraka')).send({ email: 'grace@baraka.test', password: PW });
    expect(login.status).toBe(200);
    expect(login.body.data.mustChangePassword).toBeFalsy();
    const tenant = await meta().Tenant.findOne({ slug: 'baraka' }).lean();
    expect(tenant!.integrations).toMatchObject({ sha: true, mpesa: true, slade360: true, africastalking: false });
    const sub = await meta().TenantSubscription.findOne({ tenantId: tenant!._id }).lean();
    expect(sub).toMatchObject({ plan: 'standard', status: 'trialing', maxBranches: 3, maxUsers: 60 });
    const after = await meta().FacilityApplication.findById(row._id).select('+admin.passwordHash').lean();
    expect(after!.admin!.passwordHash).toBeUndefined();
    expect((await own('post', `/applications/${row._id}/approve`).send({})).body.error.code).toBe('INVALID_TRANSITION');
  });

  it('rejects with a reason that the applicant can see', async () => {
    const { token } = await applyAndVerify('mercy-clinic', 'mercy@clinic.test');
    const row = (await own('get', '/applications?q=mercy')).body.data[0];
    expect((await own('post', `/applications/${row._id}/reject`).send({ reason: 'no' })).status).toBe(400);
    expect((await own('post', `/applications/${row._id}/reject`).send({ reason: 'We could not verify the facility licence.' })).status).toBe(200);
    const st = await pub().post('/onboarding/applications/status').send({ applicationToken: token });
    expect(st.body.data).toMatchObject({ status: 'rejected', rejectionReason: 'We could not verify the facility licence.' });
    expect((await pub().get('/onboarding/slug?slug=mercy-clinic')).body.data.available).toBe(true);
  });

  it('provisions immediately when the owner turns on automatic approval', async () => {
    expect((await own('put', '/settings').send({ approvalMode: 'automatic' })).status).toBe(200);
    expect((await pub().get('/onboarding/config')).body.data.approvalMode).toBe('automatic');
    const { view } = await applyAndVerify('fastcare', 'admin@fastcare.test');
    expect(view.status).toBe('approved');
    expect(view.loginUrl).toContain('fastcare.afeysync.test');
    expect((await api().post('/api/v1/auth/login').set('Host', hostOf('fastcare')).send({ email: 'admin@fastcare.test', password: PW })).status).toBe(200);
    await own('put', '/settings').send({ approvalMode: 'manual' });
  });
});
