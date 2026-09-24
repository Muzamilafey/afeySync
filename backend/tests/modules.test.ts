import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, createUser, hostOf, ownerToken, PASSWORD, setupApp, t, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';
import { runNextJob } from '../src/jobs/queue';
import { registerJobHandlers } from '../src/jobs/handlers';
import { validateResource } from '../src/modules/fhir/validator';
import { defaultConfig, toPatient } from '../src/modules/fhir/mappers';

const S = 'modfac';
let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let reception: string;
let otherReception: string;
let doctor: string;
let accountant: string;
let accountant2: string;
let hr: string;
let patientId: string;

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

beforeAll(async () => {
  await setupApp();
  registerJobHandlers();
  const owner = await ownerToken();
  F = await createFacility(owner, S, [{ branchName: 'Main', branchCode: 'MAIN' }, { branchName: 'Two', branchCode: 'TWO' }]);
  admin = (await tenantLogin(S, F.admin.email)).token;
  const b = [F.branches[0].id];
  reception = await createUser(S, admin, { email: 'rec@mod.test', roleKey: 'receptionist', branchAccess: 'specific', branchIds: b });
  otherReception = await createUser(S, admin, { email: 'rec2@mod.test', roleKey: 'receptionist', branchAccess: 'specific', branchIds: [F.branches[1].id] });
  doctor = await createUser(S, admin, { email: 'doc@mod.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: b });
  accountant = await createUser(S, admin, { email: 'acc@mod.test', roleKey: 'accountant', branchAccess: 'all', branchIds: [] });
  accountant2 = await createUser(S, admin, { email: 'acc2@mod.test', roleKey: 'accountant', branchAccess: 'all', branchIds: [] });
  hr = await createUser(S, admin, { email: 'hr@mod.test', roleKey: 'hr_officer', branchAccess: 'all', branchIds: [] });
  const p = await t(S, reception).post('/api/v1/patients').send({ firstName: 'Doc', lastName: 'Patient', gender: 'female', phone: '0711000111' });
  patientId = p.body.data._id;
});
afterAll(teardown);

describe('documents', () => {
  let docId: string;
  it('accepts sniffed PDFs, rejects disguised files', async () => {
    const bad = await t(S, reception, F.branches[0].id).post('/api/v1/documents').field('category', 'other').field('title', 'Evil').field('patientId', patientId).attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(bad.status).toBe(415);
    const ok = await t(S, reception, F.branches[0].id).post('/api/v1/documents').field('category', 'identification').field('title', 'National ID').field('patientId', patientId).attach('file', PDF, { filename: 'id "copy".pdf', contentType: 'application/octet-stream' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.mimeType).toBe('application/pdf');
    expect(ok.body.data.storageKey).toBeUndefined();
    expect(ok.body.data.sha256).toMatch(/^[a-f0-9]{64}$/);
    docId = ok.body.data._id;
  });

  it('downloads with no-store headers and enforces patient branch access', async () => {
    const dl = await t(S, reception).get(`/api/v1/documents/${docId}/download`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(dl.status).toBe(200);
    expect(dl.headers['cache-control']).toContain('no-store');
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect((dl.body as Buffer).equals(PDF)).toBe(true);
    expect((await t(S, otherReception).get(`/api/v1/documents/${docId}/download`)).status).toBe(404);
    expect((await t(S, otherReception).get(`/api/v1/documents?patientId=${patientId}`)).status).toBe(404);
    const list = await t(S, reception).get(`/api/v1/documents?patientId=${patientId}`);
    expect(list.body.data).toHaveLength(1);
  });

  it('soft-deletes with a reason and audits', async () => {
    await t(S, reception, F.branches[0].id).post('/api/v1/documents').field('category', 'consent').field('title', 'Consent form').field('patientId', patientId).attach('file', PNG, 'consent.png');
    expect((await t(S, reception).post(`/api/v1/documents/${docId}/delete`).send({ reason: 'x' })).status).toBe(400);
    expect((await t(S, reception).post(`/api/v1/documents/${docId}/delete`).send({ reason: 'Uploaded to wrong patient' })).status).toBe(200);
    const list = await t(S, reception).get(`/api/v1/documents?patientId=${patientId}`);
    expect(list.body.data.map((d: { title: string }) => d.title)).toEqual(['Consent form']);
    const audit = await t(S, admin).get('/api/v1/admin/audit?action=document.delete');
    expect(audit.body.data.length).toBe(1);
  });
});

describe('password reset', () => {
  it('never reveals account existence and resets with a single-use token', async () => {
    const unknown = await api().post('/api/v1/auth/forgot-password').set('Host', hostOf(S)).send({ email: 'nobody@mod.test' });
    const known = await api().post('/api/v1/auth/forgot-password').set('Host', hostOf(S)).send({ email: 'rec@mod.test' });
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
    const job = await meta().Job.findOne({ type: 'EMAIL', 'payload.to': 'rec@mod.test' }).lean();
    const token = /token=([A-Za-z0-9_-]+)/.exec(String((job!.payload as { text: string }).text))![1];
    expect((await api().post('/api/v1/auth/reset-password').set('Host', hostOf(S)).send({ token, newPassword: 'short' })).status).toBe(400);
    const r = await api().post('/api/v1/auth/reset-password').set('Host', hostOf(S)).send({ token, newPassword: 'N3wStr0ngPassw0rd!' });
    expect(r.status).toBe(200);
    // Old sessions revoked; new password works; token is single-use.
    expect((await t(S, reception).get('/api/v1/auth/me')).status).toBe(401);
    reception = (await tenantLogin(S, 'rec@mod.test', 'N3wStr0ngPassw0rd!')).token;
    expect((await api().post('/api/v1/auth/reset-password').set('Host', hostOf(S)).send({ token, newPassword: PASSWORD })).body.error.code).toBe('RESET_TOKEN_INVALID');
  });
});

describe('finance', () => {
  it('requires a second person to approve expenses', async () => {
    const e = await t(S, accountant, F.branches[0].id).post('/api/v1/finance/expenses').send({ category: 'Utilities', amount: 5000, paidTo: 'KPLC' });
    expect(e.status).toBe(201);
    expect(e.body.data.expenseNumber).toMatch(/^EXP/);
    expect((await t(S, accountant).post(`/api/v1/finance/expenses/${e.body.data._id}/approve`)).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await t(S, accountant2).post(`/api/v1/finance/expenses/${e.body.data._id}/approve`)).status).toBe(200);
    expect((await t(S, accountant2).post(`/api/v1/finance/expenses/${e.body.data._id}/approve`)).status).toBe(409);
    expect((await t(S, doctor, F.branches[0].id).post('/api/v1/finance/expenses').send({ category: 'X', amount: 1 })).status).toBe(403);
  });

  it('summarises cash position', async () => {
    const s = await t(S, accountant).get('/api/v1/finance/summary');
    expect(s.status).toBe(200);
    expect(s.body.data.expenses).toBe(5000);
    expect(s.body.data.expensesByCategory.Utilities).toBe(5000);
    expect(s.body.data.netCash).toBe(-5000);
  });
});

describe('HR', () => {
  let staffId: string;
  let doctorStaffId: string;
  it('manages staff records and licence alerts', async () => {
    const s = await t(S, hr).post('/api/v1/hr/staff').send({ fullName: 'Halima Abdi', cadre: 'Nurse', licenseNumber: 'NCK-1234', licenseExpiry: new Date(Date.now() + 10 * 86400_000).toISOString() });
    expect(s.status).toBe(201);
    expect(s.body.data.employeeNumber).toMatch(/^EMP-\d{5}$/);
    staffId = s.body.data._id;
    const alerts = await t(S, hr).get('/api/v1/hr/staff/license-alerts');
    expect(alerts.body.data.map((a: { _id: string }) => a._id)).toContain(staffId);
    expect((await t(S, doctor).get('/api/v1/hr/staff')).status).toBe(403);
  });

  it('lets staff request their own leave but not approve it', async () => {
    const users = await t(S, admin).get('/api/v1/users?q=doc');
    const d = await t(S, hr).post('/api/v1/hr/staff').send({ fullName: 'Dr Doc', userId: users.body.data[0]._id, cadre: 'Doctor' });
    doctorStaffId = d.body.data._id;
    const l = await t(S, doctor).post('/api/v1/hr/leave').send({ type: 'annual', startDate: '2030-01-06', endDate: '2030-01-10' });
    expect(l.status).toBe(201);
    expect(l.body.data.days).toBe(5);
    expect((await t(S, doctor).post('/api/v1/hr/leave').send({ type: 'sick', startDate: '2030-01-08', endDate: '2030-01-08' })).status).toBe(409);
    expect((await t(S, doctor).post('/api/v1/hr/leave').send({ staffId, type: 'sick', startDate: '2030-02-01', endDate: '2030-02-01' })).status).toBe(403);
    expect((await t(S, hr).post(`/api/v1/hr/leave/${l.body.data._id}/approve`)).status).toBe(200);
  });

  it('blocks rostering staff who are on approved leave', async () => {
    const r = await t(S, hr).post('/api/v1/hr/shifts').send({ staffId: doctorStaffId, branchId: F.branches[0].id, date: '2030-01-07', shift: 'day' });
    expect(r.body.error.code).toBe('STAFF_ON_LEAVE');
    expect((await t(S, hr).post('/api/v1/hr/shifts').send({ staffId, branchId: F.branches[0].id, date: '2030-01-07', shift: 'day' })).status).toBe(201);
    expect((await t(S, hr).post('/api/v1/hr/shifts').send({ staffId, branchId: F.branches[0].id, date: '2030-01-07', shift: 'day' })).status).toBe(409);
  });

  it('registry verification reports an unconfigured operation honestly', async () => {
    const v = await t(S, hr).post(`/api/v1/hr/staff/${staffId}/verify-registry`);
    expect([501, 503]).toContain(v.status);
  });
});

describe('reports', () => {
  it('lists reports by permission and exports CSV only with reports.export', async () => {
    const list = await t(S, accountant).get('/api/v1/reports');
    expect(list.body.data.map((r: { key: string }) => r.key)).toEqual(expect.arrayContaining(['revenue', 'expenses', 'opd']));
    expect((await t(S, reception).get('/api/v1/reports')).status).toBe(403);
    const exp = await t(S, accountant).get('/api/v1/reports/expenses');
    expect(exp.status).toBe(200);
    expect(exp.body.data.columns.length).toBeGreaterThan(0);
    const csv = await t(S, accountant).get('/api/v1/reports/expenses?format=csv');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toContain('"');
    expect((await t(S, accountant).get('/api/v1/reports/nope')).status).toBe(404);
  });

  it('neutralises spreadsheet formulas in CSV output', async () => {
    const e = await t(S, accountant, F.branches[0].id).post('/api/v1/finance/expenses').send({ category: '=HYPERLINK("http://evil")', amount: 10 });
    await t(S, accountant2).post(`/api/v1/finance/expenses/${e.body.data._id}/approve`);
    const csv = await t(S, accountant).get('/api/v1/reports/expenses?format=csv');
    expect(csv.text).not.toMatch(/(^|,)"=HYPERLINK/m);
    expect(csv.text).toContain(`"'=HYPERLINK`);
  });
});

describe('FHIR', () => {
  it('maps patients to valid FHIR R4 and flags structural errors', () => {
    const cfg = defaultConfig('x');
    const p = toPatient(cfg, { _id: '65a000000000000000000001', patientNumber: 'AFS-0000001', firstName: 'A', lastName: 'B', gender: 'female', dateOfBirth: new Date('1990-01-01'), identifiers: [] } as never);
    expect(p.resourceType).toBe('Patient');
    expect(validateResource(p as never)).toEqual([]);
    expect(validateResource({ resourceType: 'Patient', gender: 'robot' } as never).length).toBeGreaterThan(0);
  });

  it('serves resources with RBAC and queues finalized consultations to the outbox', async () => {
    const md = await t(S, doctor).get('/api/v1/fhir/metadata');
    expect(md.body.resourceType).toBe('CapabilityStatement');
    const pt = await t(S, doctor).get(`/api/v1/fhir/Patient/${patientId}`);
    expect(pt.status).toBe(200);
    expect(pt.body.resourceType).toBe('Patient');

    const v = await t(S, reception).post('/api/v1/visits').send({ patientId });
    const visitId = v.body.data.visit._id;
    await t(S, doctor).post('/api/v1/opd/vitals').send({ visitId, temperatureC: 37.0, pulse: 80, systolic: 120, diastolic: 80 });
    const c = await t(S, doctor).post('/api/v1/consultations').send({ visitId, chiefComplaint: 'Cough for two weeks' });
    await t(S, doctor).patch(`/api/v1/consultations/${c.body.data._id}`).send({ examination: 'Chest clear', diagnoses: [{ code: 'CA23', display: 'Asthma', system: 'ICD-11' }], plan: 'Inhaler' });
    expect((await t(S, doctor).post(`/api/v1/consultations/${c.body.data._id}/finalize`)).status).toBe(200);

    const outbox = await t(S, admin).get('/api/v1/fhir/outbox');
    expect(outbox.status).toBe(200);
    const entry = outbox.body.data.find((e: { localId: string }) => e.localId === c.body.data._id);
    expect(entry).toBeDefined();
    expect(entry.validation.valid).toBe(true);
    expect(entry.status).toBe('queued');
    expect((await t(S, doctor).get('/api/v1/fhir/outbox')).status).toBe(403);

    // Run the queue: the SHR write op has no documented path, so the entry is blocked (never faked as sent).
    for (let i = 0; i < 20 && (await runNextJob()); i++);
    const after = await t(S, admin).get(`/api/v1/fhir/outbox/${entry._id}`);
    expect(['blocked', 'failed']).toContain(after.body.data.status);
    expect(after.body.data.status).not.toBe('sent');
    expect(after.body.data.lastError).toBeTruthy();
    const ev = await t(S, admin).get(`/api/v1/fhir/Patient/${patientId}/$everything`);
    expect(ev.body.resourceType).toBe('Bundle');
    expect(ev.body.entry.some((e: { resource: { resourceType: string } }) => e.resource.resourceType === 'Condition')).toBe(true);
  });
});
