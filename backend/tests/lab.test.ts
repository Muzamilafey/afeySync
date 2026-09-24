import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFacility, createUser, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';

const S = 'labfac';
let admin: string;
let doctor: string;
let tech: string;
let tech2: string;
let labMgr: string;
let radiologist: string;
let visitId: string;

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  const F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
  const b = [F.branches[0].id];
  doctor = await createUser(S, admin, { email: 'doc@lab.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: b });
  tech = await createUser(S, admin, { email: 'tech@lab.test', roleKey: 'lab_technologist', branchAccess: 'specific', branchIds: b });
  tech2 = await createUser(S, admin, { email: 'tech2@lab.test', roleKey: 'lab_manager', branchAccess: 'specific', branchIds: b });
  labMgr = await createUser(S, admin, { email: 'mgr@lab.test', roleKey: 'lab_manager', branchAccess: 'specific', branchIds: b });
  radiologist = await createUser(S, admin, { email: 'rad@lab.test', roleKey: 'radiologist', branchAccess: 'specific', branchIds: b });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'LAB-FBC', name: 'FBC', category: 'laboratory', prices: [{ priceList: 'cash', amount: 800 }] });
  const p = await t(S, admin).post('/api/v1/patients').send({ firstName: 'Lab', lastName: 'Patient', gender: 'female', dateOfBirth: '1990-01-01', phone: '0712000999' });
  const v = await t(S, admin).post('/api/v1/visits').send({ patientId: p.body.data._id, firstStage: 'consultation' });
  visitId = v.body.data.visit._id;
});
afterAll(teardown);

describe('laboratory workflow', () => {
  let orderId: string;
  let fbc: string;
  let mps: string;

  it('orders tests from the seeded catalog, posts charges and queues the lab', async () => {
    const tests = await t(S, tech).get('/api/v1/laboratory/tests');
    expect(tests.body.data.map((x: { code: string }) => x.code)).toEqual(expect.arrayContaining(['FBC', 'MPS', 'UEC']));
    expect((await t(S, tech).post('/api/v1/laboratory/orders').send({ visitId, tests: ['FBC'] })).status).toBe(403);
    const o = await t(S, doctor).post('/api/v1/laboratory/orders').send({ visitId, tests: ['FBC', 'MPS'], priority: 'urgent', clinicalNotes: 'Febrile' });
    expect(o.status).toBe(201);
    orderId = o.body.data._id;
    fbc = o.body.data.items.find((i: { testCode: string }) => i.testCode === 'FBC')._id;
    mps = o.body.data.items.find((i: { testCode: string }) => i.testCode === 'MPS')._id;
    const inv = await t(S, admin).get(`/api/v1/billing/invoices?visitId=${visitId}`);
    const full = await t(S, admin).get(`/api/v1/billing/invoices/${inv.body.data[0]._id}`);
    expect(full.body.data.lines).toHaveLength(2);
    expect(full.body.data.totals.gross).toBe(800);
    const q = await t(S, tech).get('/api/v1/queues?stage=laboratory');
    expect(q.body.data).toHaveLength(1);
  });

  it('enforces the sample → result → verify → approve sequence with segregation of duties', async () => {
    const step = (tok: string, item: string, s: string, body: object = {}) => t(S, tok).post(`/api/v1/laboratory/orders/${orderId}/items/${item}/${s}`).send(body);
    expect((await step(tech, fbc, 'result', { results: [{ parameter: 'HB', value: '10' }] })).body.error.code).toBe('INVALID_LAB_TRANSITION');
    const c = await step(tech, fbc, 'collect');
    const acc = c.body.data.items.find((i: { _id: string }) => i._id === fbc).accessionNumber;
    expect(acc).toMatch(/^L\d{10}$/);
    expect((await t(S, tech).get(`/api/v1/laboratory/accession/${acc}`)).body.data.item.testCode).toBe('FBC');
    await step(tech, fbc, 'receive');
    const r = await step(tech, fbc, 'result', { results: [{ parameter: 'HB', value: '6.2' }, { parameter: 'WBC', value: '12.5' }, { parameter: 'PLT', value: '250' }] });
    const item = r.body.data.items.find((i: { _id: string }) => i._id === fbc);
    expect(item.results.find((x: { parameter: string }) => x.parameter === 'HB')).toEqual(expect.objectContaining({ flag: 'LL', critical: true, referenceRange: '12–15.5' }));
    expect(item.results.find((x: { parameter: string }) => x.parameter === 'WBC').flag).toBe('H');
    const notes = await t(S, doctor).get('/api/v1/notifications');
    expect(notes.body.data[0].title).toMatch(/^CRITICAL: Full Blood Count/);
    expect((await step(tech, fbc, 'verify')).status).toBe(403);
    expect((await step(tech2, fbc, 'verify')).status).toBe(200);
    expect((await step(tech, fbc, 'approve')).status).toBe(403);
    const a = await step(labMgr, fbc, 'approve');
    expect(a.body.data.items.find((i: { _id: string }) => i._id === fbc).status).toBe('released');
    const report = await t(S, doctor).get(`/api/v1/laboratory/orders/${orderId}/report`);
    expect(report.body.data.items).toHaveLength(1);
    expect(report.body.data.pending).toEqual(['Malaria Parasites (BS for MPS)']);
  });

  it('cancelling a test requires a reason, voids its charge and completes the order', async () => {
    expect((await t(S, doctor).post(`/api/v1/laboratory/orders/${orderId}/items/${mps}/cancel`).send({})).status).toBe(400);
    const c = await t(S, doctor).post(`/api/v1/laboratory/orders/${orderId}/items/${mps}/cancel`).send({ reason: 'Patient declined' });
    expect(c.body.data.status).toBe('completed');
    const inv = await t(S, admin).get(`/api/v1/billing/invoices?visitId=${visitId}`);
    const full = await t(S, admin).get(`/api/v1/billing/invoices/${inv.body.data[0]._id}`);
    expect(full.body.data.lines.filter((l: { voided: boolean }) => !l.voided)).toHaveLength(1);
  });

  it('option results are flagged abnormal against the normal value', async () => {
    const o = await t(S, doctor).post('/api/v1/laboratory/orders').send({ visitId, tests: ['MRDT'] });
    const id = o.body.data._id;
    const it = o.body.data.items[0]._id;
    for (const s of ['collect', 'receive']) await t(S, tech).post(`/api/v1/laboratory/orders/${id}/items/${it}/${s}`);
    const r = await t(S, tech).post(`/api/v1/laboratory/orders/${id}/items/${it}/result`).send({ results: [{ parameter: 'MRDT', value: 'Positive' }] });
    expect(r.body.data.items[0].results[0].flag).toBe('A');
    await t(S, tech2).post(`/api/v1/laboratory/orders/${id}/items/${it}/verify`);
    await t(S, labMgr).post(`/api/v1/laboratory/orders/${id}/items/${it}/approve`);
    const jobs = await meta().Job.countDocuments({ type: 'SMS', idempotencyKey: new RegExp(`lab:${id}:ready`) });
    expect(jobs).toBe(1);
  });
});

describe('radiology workflow', () => {
  it('requests with DICOM identifiers, reports and verifies; worklist is MWL-shaped', async () => {
    const r = await t(S, doctor).post('/api/v1/radiology/requests').send({ visitId, examCode: 'XR-CHEST', clinicalIndication: 'Cough 3 weeks, rule out TB' });
    expect(r.status).toBe(201);
    expect(r.body.data.studyInstanceUid).toMatch(/^2\.25\.\d+$/);
    const id = r.body.data._id;
    const wl = await t(S, radiologist).get('/api/v1/radiology/worklist');
    expect(wl.body.data[0]).toEqual(expect.objectContaining({ AccessionNumber: r.body.data.accessionNumber, Modality: 'XR', PatientSex: 'F', PatientName: 'Patient^Lab' }));
    expect((await t(S, radiologist).post(`/api/v1/radiology/requests/${id}/report`).send({ findings: 'x', impression: 'y' })).body.error.code).toBe('INVALID_RADIOLOGY_TRANSITION');
    await t(S, radiologist).post(`/api/v1/radiology/requests/${id}/start`);
    expect((await t(S, radiologist).post(`/api/v1/radiology/requests/${id}/report`).send({ findings: 'Clear lung fields' })).status).toBe(400);
    await t(S, radiologist).post(`/api/v1/radiology/requests/${id}/report`).send({ findings: 'Clear lung fields', impression: 'Normal chest radiograph' });
    const v = await t(S, radiologist).post(`/api/v1/radiology/requests/${id}/verify`);
    expect(v.body.data.status).toBe('verified');
    expect(v.body.data.report.impression).toBe('Normal chest radiograph');
    expect((await t(S, doctor).post(`/api/v1/radiology/requests/${id}/report`).send({ findings: 'a', impression: 'b' })).status).toBe(403);
  });
});
