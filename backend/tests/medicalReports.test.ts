import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFacility, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';

const S = 'mrfac';
let admin = '';
let patientId = '';
let visitId = '';

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  await createFacility(owner, S);
  admin = (await tenantLogin(S, `admin@${S}.test`)).token;
  const p = await t(S, admin).post('/api/v1/patients').send({ firstName: 'Achieng', lastName: 'Otieno', gender: 'female', dateOfBirth: '1990-02-01', phone: '0712345678' });
  patientId = p.body.data._id ?? p.body.data.patient?._id;
  const v = await t(S, admin).post('/api/v1/visits').send({ patientId, payer: { type: 'cash' } });
  visitId = v.body.data.visit._id;
});
afterAll(teardown);

describe('medical reports and certificates', () => {
  let id = '';
  it('writes a sick note with the right number of days', async () => {
    const r = await t(S, admin).post('/api/v1/medical-reports').send({ type: 'sick_leave', visitId, restFrom: '2026-09-20', restTo: '2026-09-22' });
    expect(r.status).toBe(201);
    expect(r.body.data.restDays).toBe(3);
    expect(r.body.data.reportNumber).toMatch(/^MR-/);
    id = r.body.data._id;
  });

  it('checks each kind of report', async () => {
    expect((await t(S, admin).post('/api/v1/medical-reports').send({ type: 'sick_leave', visitId, restFrom: '2026-09-22', restTo: '2026-09-20' })).status).toBe(400);
    expect((await t(S, admin).post('/api/v1/medical-reports').send({ type: 'fitness', visitId })).status).toBe(400);
    expect((await t(S, admin).post('/api/v1/medical-reports').send({ type: 'medical_report', visitId })).status).toBe(400);
    expect((await t(S, admin).post('/api/v1/medical-reports').send({ type: 'fitness', patientId, fitness: 'fit', fitnessPurpose: 'employment' })).status).toBe(201);
  });

  it('locks a signed report: addenda only, and voiding keeps it on record', async () => {
    expect((await t(S, admin).post(`/api/v1/medical-reports/${id}/finalize`)).status).toBe(200);
    const edit = await t(S, admin).put(`/api/v1/medical-reports/${id}`).send({ type: 'sick_leave', restFrom: '2026-09-20', restTo: '2026-09-30' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('REPORT_SIGNED');
    expect((await t(S, admin).post(`/api/v1/medical-reports/${id}/addendum`).send({ text: 'Review after three days.' })).status).toBe(200);
    expect((await t(S, admin).post(`/api/v1/medical-reports/${id}/void`).send({ reason: 'Wrong patient selected' })).status).toBe(200);
    const one = await t(S, admin).get(`/api/v1/medical-reports/${id}`);
    expect(one.body.data.report).toMatchObject({ status: 'void', restDays: 3, voidReason: 'Wrong patient selected' });
    expect(one.body.data.report.addenda).toHaveLength(1);
    const list = await t(S, admin).get('/api/v1/medical-reports').query({ patientId });
    expect(list.body.data).toHaveLength(2);
  });
});
