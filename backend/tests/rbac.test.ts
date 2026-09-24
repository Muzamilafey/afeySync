import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, OWNER_HOST, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';

let owner: string;
let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let reception: string;
let cashier: string;

beforeAll(async () => {
  await setupApp();
  owner = await ownerToken();
  F = await createFacility(owner, 'rbac', [
    { branchName: 'Main', branchCode: 'MAIN' },
    { branchName: 'Two', branchCode: 'TWO' },
  ]);
  admin = (await tenantLogin('rbac', F.admin.email)).token;
  reception = await createUser('rbac', admin, { email: 'rec@rbac.test', roleKey: 'receptionist', branchAccess: 'specific', branchIds: [F.branches[0].id] });
  cashier = await createUser('rbac', admin, { email: 'cash@rbac.test', roleKey: 'cashier', branchAccess: 'specific', branchIds: [F.branches[0].id] });
});
afterAll(teardown);

describe('RBAC', () => {
  it('enforces permissions on the server regardless of UI', async () => {
    expect((await t('rbac', cashier).post('/api/v1/patients').send({ firstName: 'a', lastName: 'b', gender: 'male' })).status).toBe(403);
    expect((await t('rbac', reception).get('/api/v1/users')).status).toBe(403);
    expect((await t('rbac', reception).post('/api/v1/roles').send({ name: 'x', permissions: ['patients.view'] })).status).toBe(403);
    expect((await t('rbac', reception).get('/api/v1/admin/audit')).status).toBe(403);
  });

  it('receptionist can register patients', async () => {
    const res = await t('rbac', reception).post('/api/v1/patients').send({ firstName: 'Amina', lastName: 'Hassan', gender: 'female', phone: '0712 345 678' });
    expect(res.status).toBe(201);
    expect(res.body.data.patientNumber).toMatch(/^AFS-\d{7}$/);
    expect(res.body.data.phone).toBe('254712345678');
  });

  it('prevents privilege escalation via custom roles', async () => {
    const branchAdmin = await createUser('rbac', admin, { email: 'badmin@rbac.test', roleKey: 'branch_admin', branchAccess: 'specific', branchIds: [F.branches[0].id] });
    // branch admin lacks admin.roles
    expect((await t('rbac', branchAdmin).post('/api/v1/roles').send({ name: 'god', permissions: ['admin.roles'] })).status).toBe(403);
    // branch admin cannot assign tenant-scope roles
    const roles = await t('rbac', admin).get('/api/v1/roles');
    const facAdmin = roles.body.data.find((r: { key: string }) => r.key === 'facility_admin');
    const res = await t('rbac', branchAdmin).post('/api/v1/users').send({ name: 'Xavier', email: 'x@rbac.test', roleIds: [facAdmin._id], branchAccess: 'specific', branchIds: [F.branches[0].id], password: 'Str0ngPassw0rd!' });
    expect(res.status).toBe(403);
    // branch admin cannot create users in other branches
    const rec = roles.body.data.find((r: { key: string }) => r.key === 'receptionist');
    const res2 = await t('rbac', branchAdmin).post('/api/v1/users').send({ name: 'Yusuf', email: 'y@rbac.test', roleIds: [rec._id], branchAccess: 'specific', branchIds: [F.branches[1].id], password: 'Str0ngPassw0rd!' });
    expect(res2.status).toBe(403);
  });

  it('supports custom roles', async () => {
    const res = await t('rbac', admin).post('/api/v1/roles').send({ name: 'Triage Lead', scope: 'branch', permissions: ['patients.view', 'patients.search', 'opd.view'] });
    expect(res.status).toBe(201);
    expect(res.body.data.system).toBe(false);
    expect((await t('rbac', admin).post('/api/v1/roles').send({ name: 'Bad', permissions: ['owner.platform'] })).status).toBe(400);
  });

  it('system roles cannot be deleted; admin roles cannot be edited', async () => {
    const roles = await t('rbac', admin).get('/api/v1/roles');
    const doctor = roles.body.data.find((r: { key: string }) => r.key === 'doctor');
    const facAdmin = roles.body.data.find((r: { key: string }) => r.key === 'facility_admin');
    expect((await t('rbac', admin).del(`/api/v1/roles/${doctor._id}`)).status).toBe(403);
    expect((await t('rbac', admin).patch(`/api/v1/roles/${facAdmin._id}`).send({ permissions: ['patients.view'] })).status).toBe(403);
  });

  it('suspending a user revokes their sessions', async () => {
    const tok = await createUser('rbac', admin, { email: 'temp@rbac.test', roleKey: 'nurse', branchAccess: 'specific', branchIds: [F.branches[0].id] });
    const users = await t('rbac', admin).get('/api/v1/users?q=temp');
    await t('rbac', admin).post(`/api/v1/users/${users.body.data[0]._id}/suspend`);
    expect((await t('rbac', tok).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('writes an append-only audit trail', async () => {
    const res = await t('rbac', admin).get('/api/v1/admin/audit?action=patient.create');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toEqual(expect.objectContaining({ userName: expect.any(String), ip: expect.any(String), resource: 'patient' }));
  });

  it('platform support needs approved, time-limited access to see clinical data', async () => {
    const p = await t('rbac', admin).post('/api/v1/patients').send({ firstName: 'Sup', lastName: 'Port', gender: 'male' });
    const req = await api().post('/api/v1/owner/support-access').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ tenantId: F.id, reason: 'Investigating registration bug ticket #42', durationMinutes: 30, permissions: ['patients.view'] });
    expect(req.status).toBe(201);
    const early = await api().post(`/api/v1/owner/support-access/${req.body.data._id}/session`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    expect(early.status).toBe(403);
    expect((await t('rbac', admin).post(`/api/v1/admin/support-access/${req.body.data._id}/approve`)).status).toBe(200);
    const sess = await api().post(`/api/v1/owner/support-access/${req.body.data._id}/session`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    expect(sess.status).toBe(200);
    const sup = sess.body.data.accessToken;
    expect((await t('rbac', sup).get(`/api/v1/patients/${p.body.data._id}`)).status).toBe(200);
    expect((await t('rbac', sup).post('/api/v1/patients').send({ firstName: 'x', lastName: 'y', gender: 'male' })).status).toBe(403);
    await t('rbac', admin).post(`/api/v1/admin/support-access/${req.body.data._id}/revoke`);
    expect((await t('rbac', sup).get(`/api/v1/patients/${p.body.data._id}`)).status).toBe(401);
    const audit = await t('rbac', admin).get('/api/v1/admin/audit?action=patient.view');
    expect(audit.body.data.some((a: { actorType: string }) => a.actorType === 'support')).toBe(true);
  });
});
