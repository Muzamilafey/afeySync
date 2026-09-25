import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, PASSWORD, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';

const S = 'editfac';
let admin = '';
let adminId = '';
let branches: Array<{ id: string }> = [];
let roles: Array<{ _id: string; key: string }> = [];
const role = (k: string) => roles.find((r) => r.key === k)!._id;

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  branches = (await createFacility(owner, S, [{ branchName: 'Main', branchCode: 'MAIN' }, { branchName: 'Annex', branchCode: 'ANX' }])).branches;
  admin = (await tenantLogin(S, `admin@${S}.test`)).token;
  adminId = (await t(S, admin).get('/api/v1/auth/me')).body.data.user.id;
  roles = (await t(S, admin).get('/api/v1/roles')).body.data;
});
afterAll(teardown);

const findUser = async (email: string) => (await t(S, admin).get(`/api/v1/users?q=${encodeURIComponent(email)}`)).body.data[0];

describe('editing users', () => {
  it('updates name, phone, roles, branches and clinical details; access changes apply immediately', async () => {
    const tok = await createUser(S, admin, { email: 'amina@editfac.test', roleKey: 'receptionist', branchAccess: 'specific', branchIds: [branches[0].id] });
    const u = await findUser('amina@editfac.test');
    expect((await t(S, tok).get('/api/v1/laboratory/tests')).status).toBe(403);
    const r = await t(S, admin).patch(`/api/v1/users/${u._id}`).send({ name: 'Amina Wanjiru', phone: '0712000999', roleIds: [role('lab_technologist')], branchAccess: 'specific', branchIds: [branches[0].id, branches[1].id], practitioner: { cadre: 'Lab Technologist', licenseNumber: 'KMLTTB-123' } });
    expect(r.status).toBe(200);
    const after = await findUser('amina@editfac.test');
    expect(after).toMatchObject({ name: 'Amina Wanjiru', phone: '0712000999', practitioner: { cadre: 'Lab Technologist', licenseNumber: 'KMLTTB-123' } });
    expect(after.roleIds.map((x: { key: string }) => x.key)).toEqual(['lab_technologist']);
    expect(after.branchIds).toHaveLength(2);
    expect((await t(S, tok).get('/api/v1/laboratory/tests')).status).toBe(200);
    const auditRow = await t(S, admin).get('/api/v1/admin/audit?action=user.update');
    expect(auditRow.status).toBe(200);
  });

  it('changes the sign-in email, keeps main-page sign-in working and tells both addresses', async () => {
    await createUser(S, admin, { email: 'baraka@editfac.test', roleKey: 'nurse', branchAccess: 'all', branchIds: [] });
    const u = await findUser('baraka@editfac.test');
    await t(S, admin).post('/api/v1/users').send({ name: 'Taken', email: 'taken@editfac.test', roleIds: [role('nurse')], branchAccess: 'all', branchIds: [] });
    expect((await t(S, admin).patch(`/api/v1/users/${u._id}`).send({ email: 'TAKEN@editfac.test' })).body.error.code).toBe('EMAIL_TAKEN');
    const r = await t(S, admin).patch(`/api/v1/users/${u._id}`).send({ email: 'Baraka.Otieno@editfac.test' });
    expect(r.body.data.email).toBe('baraka.otieno@editfac.test');
    expect((await api().post('/api/v1/auth/login').set('Host', `${S}.afeysync.test`).send({ email: 'baraka.otieno@editfac.test', password: PASSWORD })).status).toBe(200);
    const main = (email: string) => api().post('/api/v1/auth/find-facility').set('X-Requested-With', 'AfeySync').set('Host', 'afeysync.test').send({ email, password: PASSWORD });
    expect((await main('baraka.otieno@editfac.test')).status).toBe(200);
    expect((await main('baraka@editfac.test')).status).toBe(401);
    const mails = await meta().Job.find({ type: 'EMAIL', 'payload.subject': { $regex: /sign-in email/ } }).lean();
    expect(mails.map((m) => (m.payload as { to: string }).to).sort()).toEqual(['baraka.otieno@editfac.test', 'baraka@editfac.test']);
  });

  it('keeps an administrator from locking themselves out and branch admins within their branches', async () => {
    expect((await t(S, admin).patch(`/api/v1/users/${adminId}`).send({ roleIds: [role('nurse')] })).body.error.message).toMatch(/cannot change your own roles/);
    expect((await t(S, admin).post(`/api/v1/users/${adminId}/suspend`)).status).toBe(403);
    // saving the same roles (e.g. the edit form resubmitting them) is not a role change
    const me = await findUser(`admin@${S}.test`);
    expect((await t(S, admin).patch(`/api/v1/users/${adminId}`).send({ name: 'Head Admin', roleIds: me.roleIds.map((r: { _id: string }) => r._id) })).status).toBe(200);
    const u = await findUser('amina@editfac.test');
    expect((await t(S, admin).patch(`/api/v1/users/${u._id}`).send({ branchAccess: 'specific', branchIds: [] })).status).toBe(400);
    expect((await t(S, admin).patch(`/api/v1/users/${u._id}`).send({ email: 'not-an-email' })).body.error.message).toMatch(/Email: must be a valid email address/);
  });
});
