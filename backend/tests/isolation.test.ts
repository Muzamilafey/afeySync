import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, configureHie, createFacility, createUser, hostOf, OWNER_HOST, ownerToken, setupApp, startHieStub, t, teardown, tenantLogin } from './helpers';

let owner: string;
let A: Awaited<ReturnType<typeof createFacility>>;
let B: Awaited<ReturnType<typeof createFacility>>;
let tokA: string;
let tokB: string;
let patientB: string;
let txB: string;
let stub: Awaited<ReturnType<typeof startHieStub>>;

const newPatient = (n: string, nationalId?: string) => ({ firstName: 'Pat', lastName: n, gender: 'female', dateOfBirth: '1995-05-01', phone: '0722000000', nationalId });

beforeAll(async () => {
  await setupApp();
  stub = await startHieStub();
  owner = await ownerToken();
  await configureHie(owner, stub.baseUrl);
  A = await createFacility(owner, 'tenanta');
  B = await createFacility(owner, 'tenantb', [
    { branchName: 'B Main', branchCode: 'BMAIN' },
    { branchName: 'B Two', branchCode: 'BTWO' },
  ]);
  tokA = (await tenantLogin('tenanta', A.admin.email)).token;
  tokB = (await tenantLogin('tenantb', B.admin.email)).token;
  const p = await t('tenantb', tokB).post('/api/v1/patients').send(newPatient('Bee', '11112222'));
  expect(p.status).toBe(201);
  patientB = p.body.data._id;
  const tx = await t('tenantb', tokB).post('/api/v1/sha/transactions').send({ kind: 'claim', patientId: patientB, lines: [{ serviceCode: 'C1', description: 'Consult', quantity: 1, unitPrice: 500 }] });
  expect(tx.status).toBe(201);
  txB = tx.body.data._id;
});
afterAll(async () => {
  await stub.close();
  await teardown();
});

describe('CRITICAL: tenant isolation (Tenant A user vs Tenant B data)', () => {
  it('uses a separate database per tenant', async () => {
    const list = await t('tenanta', tokA).get('/api/v1/patients');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);
    const search = await t('tenanta', tokA).get('/api/v1/patients/search?q=Bee');
    expect(search.body.data).toHaveLength(0);
  });

  it('blocks Patient B by id', async () => {
    const res = await t('tenanta', tokA).get(`/api/v1/patients/${patientB}`);
    expect(res.status).toBe(404);
  });

  it('blocks Claim B / SHA record B', async () => {
    expect((await t('tenanta', tokA).get(`/api/v1/sha/transactions/${txB}`)).status).toBe(404);
    const list = await t('tenanta', tokA).get('/api/v1/sha/transactions');
    expect(list.body.data).toHaveLength(0);
  });

  it('blocks SHA eligibility/benefits for Patient B', async () => {
    expect((await t('tenanta', tokA).post('/api/v1/sha/eligibility').send({ patientId: patientB })).status).toBe(404);
    expect((await t('tenanta', tokA).get(`/api/v1/sha/benefits?patientId=${patientB}`)).status).toBe(404);
  });

  it('blocks Branch B', async () => {
    const branchB = B.branches[0].id;
    expect((await t('tenanta', tokA, branchB).get('/api/v1/auth/me')).status).toBe(403);
    expect((await t('tenanta', tokA).get(`/api/v1/branches/${branchB}`)).status).toBe(404);
  });

  it('rejects a Tenant A token presented on Tenant B hostname', async () => {
    const res = await api().get(`/api/v1/patients/${patientB}`).set('Host', hostOf('tenantb')).set('Authorization', `Bearer ${tokA}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_MISMATCH');
  });

  it('ignores client-supplied tenant identifiers', async () => {
    const res = await t('tenanta', tokA).get('/api/v1/patients').set('X-Tenant-Id', B.id).query({ tenantId: B.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('blocks Tenant B integration credentials and never exposes secrets', async () => {
    const res = await t('tenanta', tokA).get('/api/v1/admin/integrations');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('good-secret');
    expect(res.body.data.status.sha.enabled).toBe(true);
    // Facility credentials are not allowed unless the owner permits them
    const put = await t('tenanta', tokA).put('/api/v1/admin/integrations/sha').send({ secrets: { clientSecret: 'x' } });
    expect(put.status).toBe(403);
    const ownerView = await api().get('/api/v1/owner/integrations').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    expect(JSON.stringify(ownerView.body)).not.toContain('good-secret');
    expect(JSON.stringify(ownerView.body)).not.toContain('client-1');
  });

  it('does not expose DHA record annotations for Tenant B patients', async () => {
    // Same national ID exists in tenant B; tenant A registry search must not reveal it
    const res = await t('tenanta', tokA).get('/api/v1/dha/registries/patients?identification_type=National%20ID&identification_number=12345678');
    expect(res.status).toBe(200);
    expect(res.body.data.results[0].existingPatient).toBeNull();
  });

  it('owner analytics never include clinical records', async () => {
    const res = await api().get(`/api/v1/owner/tenants/${B.id}`).set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('Bee');
  });
});

describe('CRITICAL: branch isolation', () => {
  let branchUser: string;
  let patientInTwo: string;
  const [main, two] = [0, 1];

  beforeAll(async () => {
    branchUser = await createUser('tenantb', tokB, { email: 'nurse@tenantb.test', roleKey: 'receptionist', branchAccess: 'specific', branchIds: [B.branches[main].id] });
    const p = await t('tenantb', tokB, B.branches[two].id).post('/api/v1/patients').send(newPatient('TwoOnly', '55556666'));
    expect(p.status).toBe(201);
    patientInTwo = p.body.data._id;
  });

  it('branch A user cannot read branch B records', async () => {
    expect((await t('tenantb', branchUser).get(`/api/v1/patients/${patientInTwo}`)).status).toBe(403);
    const s = await t('tenantb', branchUser).get('/api/v1/patients/search?q=TwoOnly');
    expect(s.body.data).toHaveLength(0);
  });

  it('branch A user cannot switch into branch B', async () => {
    const res = await t('tenantb', branchUser, B.branches[two].id).get('/api/v1/auth/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BRANCH_FORBIDDEN');
  });

  it('branch A user cannot see branch B claims', async () => {
    const other = await t('tenantb', tokB, B.branches[two].id).post('/api/v1/sha/transactions').send({ kind: 'claim', patientId: patientInTwo });
    expect(other.status).toBe(201);
    const shaOfficer = await createUser('tenantb', tokB, { email: 'shaoff@tenantb.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: [B.branches[main].id] });
    expect((await t('tenantb', shaOfficer).get(`/api/v1/sha/transactions/${other.body.data._id}`)).status).toBe(403);
  });

  it('duplicate check across branches reveals only minimal info', async () => {
    const res = await t('tenantb', branchUser).post('/api/v1/patients').send(newPatient('Again', '55556666'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PATIENT_EXISTS');
    expect(res.body.error.details[0]).toEqual(expect.objectContaining({ accessible: false }));
    expect(res.body.error.details[0].name).toBeUndefined();
  });

  it('patient can be linked into a branch only with patient number + matching identifier', async () => {
    const full = await t('tenantb', tokB).get(`/api/v1/patients/${patientInTwo}`);
    const pn = full.body.data.patientNumber;
    expect((await t('tenantb', branchUser).post('/api/v1/patients/link-branch').send({ patientNumber: pn, identifierValue: '00000000' })).status).toBe(404);
    expect((await t('tenantb', branchUser).post('/api/v1/patients/link-branch').send({ patientNumber: pn, identifierValue: '55556666' })).status).toBe(200);
    expect((await t('tenantb', branchUser).get(`/api/v1/patients/${patientInTwo}`)).status).toBe(200);
  });

  it('tenant-wide users see all branches', async () => {
    expect((await t('tenantb', tokB).get(`/api/v1/patients/${patientInTwo}`)).status).toBe(200);
  });
});
