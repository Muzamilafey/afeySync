import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, configureHie, createFacility, OWNER_HOST, ownerToken, setupApp, startHieStub, t, teardown, tenantLogin } from './helpers';
import { clearTokenCache } from '../src/integrations/hie/hieClient';

let owner: string;
let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let stub: Awaited<ReturnType<typeof startHieStub>>;
const S = 'hiefac';

beforeAll(async () => {
  await setupApp();
  stub = await startHieStub();
  owner = await ownerToken();
  await configureHie(owner, stub.baseUrl);
  F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
});
afterAll(async () => {
  await stub.close();
  await teardown();
});
beforeEach(() => {
  stub.state.calls.length = 0;
});

const search = (num: string, type = 'National ID') => t(S, admin).get(`/api/v1/dha/registries/patients?identification_type=${encodeURIComponent(type)}&identification_number=${num}`);

describe('DHA HIE authentication', () => {
  it('caches the OAuth token across calls', async () => {
    clearTokenCache();
    const before = stub.state.tokenCalls;
    await search('12345678');
    await search('12345678');
    await search('00000001');
    expect(stub.state.tokenCalls - before).toBe(1);
  });

  it('renews the token once on 401', async () => {
    const before = stub.state.tokenCalls;
    stub.state.expireTokenOnce = true;
    const res = await search('12345678');
    expect(res.status).toBe(200);
    expect(stub.state.tokenCalls - before).toBe(1);
  });

  it('owner connection test reports failures without leaking secrets', async () => {
    await api().put('/api/v1/owner/integrations/dha').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ secrets: { clientSecret: 'wrong-secret' } });
    const res = await api().post('/api/v1/owner/integrations/dha/test').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({});
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.error.code).toBe('DHA_AUTH_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('wrong-secret');
    await configureHie(owner, stub.baseUrl);
    const ok = await api().post('/api/v1/owner/integrations/dha/test').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({});
    expect(ok.body.data).toEqual(expect.objectContaining({ ok: true, token: 'VALID' }));
  });
});

describe('DHA Client Registry patient search + import', () => {
  it('calls GET /patients with identification_number and identification_type', async () => {
    const res = await search('12345678');
    expect(res.status).toBe(200);
    expect(res.body.data.found).toBe(true);
    const r = res.body.data.results[0];
    expect(r).toEqual(expect.objectContaining({ clientRegistryId: 'CR1234567890', firstName: 'JOHN', lastName: 'DOE', county: 'Mandera' }));
    const call = stub.state.calls.find((c) => c.path === '/api/v1/patients')!;
    expect(call.query).toEqual({ identification_number: '12345678', identification_type: 'National ID' });
    expect(call.headers.authorization).toMatch(/^Bearer tok-/);
  });

  it('returns not found without error', async () => {
    const res = await search('00000001');
    expect(res.status).toBe(200);
    expect(res.body.data.found).toBe(false);
  });

  it('validates identification input before calling DHA', async () => {
    const res = await search('12345678', 'Driving Licence');
    expect(res.status).toBe(400);
    expect(stub.state.calls).toHaveLength(0);
  });

  it('imports once and blocks duplicates', async () => {
    const imp = await t(S, admin).post('/api/v1/patients/import-dha').send({ identificationType: 'National ID', identificationNumber: '12345678', consent: { dataSharing: true } });
    expect(imp.status).toBe(201);
    expect(imp.body.data).toEqual(expect.objectContaining({ clientRegistryId: 'CR1234567890', nationalId: '12345678', firstName: 'JOHN', gender: 'male', phone: '254712345678' }));
    expect(imp.body.data.dha.source).toBe('client_registry');
    const again = await t(S, admin).post('/api/v1/patients/import-dha').send({ identificationType: 'National ID', identificationNumber: '12345678' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PATIENT_EXISTS');
    expect(again.body.error.details[0].patientNumber).toBe(imp.body.data.patientNumber);
    // registry search now shows the existing AfeySync patient
    const s = await search('12345678');
    expect(s.body.data.results[0].existingPatient.patientNumber).toBe(imp.body.data.patientNumber);
    // global search by CR ID and number
    const g = await t(S, admin).get('/api/v1/patients/search?q=CR1234567890');
    expect(g.body.data).toHaveLength(1);
  });
});

describe('SHA eligibility, benefits and utilization', () => {
  let patientId: string;
  beforeAll(async () => {
    const s = await t(S, admin).get('/api/v1/patients/search?q=CR1234567890');
    patientId = s.body.data[0]._id;
  });

  it('checks eligibility with ClientRegistry ID preferred and facility headers', async () => {
    const res = await t(S, admin).post('/api/v1/sha/eligibility').send({ patientId });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({ status: 'eligible', eligible: true, identificationType: 'ClientRegistry ID', scheme: 'SHA' }));
    const call = stub.state.calls.find((c) => c.path === '/api/v1/patients/eligibility')!;
    expect(call.query).toEqual({ identification_number: 'CR1234567890', identification_type: 'ClientRegistry ID' });
    expect(call.headers['x-facility-id']).toBe('FID-47-123456-1');
    expect(call.headers['x-facility-id-type']).toBe('fr-code');
    const p = await t(S, admin).get(`/api/v1/patients/${patientId}`);
    expect(p.body.data.sha.status).toBe('eligible');
  });

  it('records not-eligible results', async () => {
    const res = await t(S, admin).post('/api/v1/sha/eligibility').send({ identificationType: 'National ID', identificationNumber: '99999999' });
    expect(res.body.data.status).toBe('not_eligible');
  });

  it('retries transient failures on idempotent GETs', async () => {
    stub.state.failNext = 1;
    const res = await t(S, admin).get(`/api/v1/sha/benefits?patientId=${patientId}`);
    expect(res.status).toBe(200);
    expect(stub.state.calls.filter((c) => c.path === '/api/v1/patients/benefits')).toHaveLength(2);
    expect(stub.state.calls[0].query.patient_id).toBe('CR1234567890');
  });

  it('maps persistent upstream failure to a standard error', async () => {
    stub.state.failNext = 5;
    const res = await t(S, admin).get(`/api/v1/sha/benefits?patientId=${patientId}`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: expect.objectContaining({ code: 'SHA_UNAVAILABLE' }) });
    stub.state.failNext = 0;
  });

  it('fetches utilization', async () => {
    const res = await t(S, admin).get(`/api/v1/sha/utilization?patientId=${patientId}&interventionCode=SHA-19-404`);
    expect(res.status).toBe(200);
    expect(stub.state.calls[0].query).toEqual({ patient_id: 'CR1234567890', intervention_code: 'SHA-19-404' });
  });

  it('logs integration calls without secrets', async () => {
    const logs = await api().get('/api/v1/owner/integration-logs?provider=sha').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`);
    expect(logs.body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs.body)).not.toMatch(/good-secret|tok-\d/);
  });
});

describe('contract safety', () => {
  it('refuses undocumented/unconfigured operations instead of guessing endpoints', async () => {
    const res = await t(S, admin).get('/api/v1/dha/terminology/search?q=malaria');
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('INTEGRATION_OPERATION_NOT_CONFIGURED');
    expect(stub.state.calls).toHaveLength(0);
  });

  it('shows the platform-disabled message when the owner disables a provider', async () => {
    await api().put('/api/v1/owner/integrations/sha').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ enabled: false });
    const res = await t(S, admin).post('/api/v1/sha/eligibility').send({ identificationType: 'National ID', identificationNumber: '12345678' });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe('This integration is currently disabled by AfeySync platform administration.');
    await api().put('/api/v1/owner/integrations/sha').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`).send({ enabled: true });
  });
});
