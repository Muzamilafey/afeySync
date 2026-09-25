import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFacility, createUser, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { meta } from '../src/models/meta';

const S = 'clinfac';
let F: Awaited<ReturnType<typeof createFacility>>;
let admin: string;
let reception: string;
let nurse: string;
let doctor: string;
let doctor2: string;
let otherBranchReception: string;
let patientId: string;

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  F = await createFacility(owner, S, [{ branchName: 'Main', branchCode: 'MAIN' }, { branchName: 'Two', branchCode: 'TWO' }]);
  admin = (await tenantLogin(S, F.admin.email)).token;
  const b = [F.branches[0].id];
  reception = await createUser(S, admin, { email: 'rec@clin.test', roleKey: 'receptionist', branchAccess: 'specific', branchIds: b });
  nurse = await createUser(S, admin, { email: 'nurse@clin.test', roleKey: 'triage_nurse', branchAccess: 'specific', branchIds: b });
  doctor = await createUser(S, admin, { email: 'doc@clin.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: b });
  doctor2 = await createUser(S, admin, { email: 'doc2@clin.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: b });
  otherBranchReception = await createUser(S, admin, { email: 'rec2@clin.test', roleKey: 'receptionist', branchAccess: 'specific', branchIds: [F.branches[1].id] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'REG', name: 'Registration', category: 'registration', prices: [{ priceList: 'cash', amount: 200 }] });
  const p = await t(S, reception).post('/api/v1/patients').send({ firstName: 'Queue', lastName: 'Patient', gender: 'female', phone: '0722333444' });
  patientId = p.body.data._id;
});
afterAll(teardown);

describe('front desk & queue', () => {
  let visitId: string;
  let triageEntry: string;

  it('checks in a patient: visit, triage ticket and registration charge', async () => {
    const res = await t(S, reception).post('/api/v1/visits').send({ patientId, complaint: 'Headache', chargeServiceCodes: ['REG'] });
    expect(res.status).toBe(201);
    visitId = res.body.data.visit._id;
    triageEntry = res.body.data.queueEntry._id;
    expect(res.body.data.visit.visitNumber).toMatch(/^V-\d{6}$/);
    expect(res.body.data.queueEntry.ticket).toBe('T001');
    const inv = await t(S, admin).get(`/api/v1/billing/invoices?visitId=${visitId}`);
    expect(inv.body.data[0].totals.net).toBe(200);
  });

  it('prevents duplicate open visits and SHA visits without eligibility', async () => {
    expect((await t(S, reception).post('/api/v1/visits').send({ patientId })).body.error.code).toBe('VISIT_OPEN');
    const p2 = await t(S, reception).post('/api/v1/patients').send({ firstName: 'Sha', lastName: 'Member', gender: 'male' });
    const r = await t(S, reception).post('/api/v1/visits').send({ patientId: p2.body.data._id, payer: { type: 'sha' } });
    expect(r.body.error.code).toBe('SHA_ELIGIBILITY_REQUIRED');
  });

  it('enforces stage permissions and valid transitions', async () => {
    expect((await t(S, reception).post(`/api/v1/queues/${triageEntry}/call`)).status).toBe(403);
    expect((await t(S, nurse).post(`/api/v1/queues/${triageEntry}/complete`)).body.error.code).toBe('INVALID_QUEUE_TRANSITION');
    expect((await t(S, nurse).post(`/api/v1/queues/${triageEntry}/call`).send({ room: 'Triage 1' })).status).toBe(200);
    expect((await t(S, nurse).post(`/api/v1/queues/${triageEntry}/start`)).status).toBe(200);
  });

  it('records vitals with clinical flags and escalates emergencies', async () => {
    const v = await t(S, nurse).post('/api/v1/opd/vitals').send({ visitId, temperatureC: 39.2, pulse: 130, systolic: 85, diastolic: 50, spo2: 88, weightKg: 70, heightCm: 175 });
    expect(v.status).toBe(201);
    expect(v.body.data.flags).toEqual(expect.arrayContaining(['Fever', 'Tachycardia', 'Hypotension', 'Low SpO2']));
    expect(v.body.data.triageCategory).toBe('emergency');
    expect(v.body.data.bmi).toBe(22.86);
    const done = await t(S, nurse).post(`/api/v1/queues/${triageEntry}/complete`).send({ nextStage: 'consultation' });
    expect(done.body.data.next.stage).toBe('consultation');
    expect(done.body.data.next.priority).toBe('emergency');
    const q = await t(S, doctor).get('/api/v1/queues?stage=consultation');
    expect(q.body.data[0].visitId).toEqual(expect.objectContaining({ visitNumber: expect.any(String) }));
  });

  it('orders emergency patients first', async () => {
    const e = await t(S, reception).post('/api/v1/visits/emergency').send({ gender: 'male', estimatedAgeYears: 40, description: 'RTA, unconscious' });
    expect(e.status).toBe(201);
    expect(e.body.data.patient.firstName).toBe('Unknown');
    const q = await t(S, doctor).get('/api/v1/queues?stage=consultation');
    expect(q.body.data[0].priority).toBe('emergency');
  });

  it('isolates visits by branch', async () => {
    expect((await t(S, otherBranchReception).get(`/api/v1/visits/${visitId}`)).status).toBe(403);
    const list = await t(S, otherBranchReception).get('/api/v1/visits');
    expect(list.body.data).toHaveLength(0);
  });

  describe('consultation', () => {
    let cid: string;
    it('drafts, requires diagnosis to finalize, then becomes immutable', async () => {
      const c = await t(S, doctor).post('/api/v1/consultations').send({ visitId, chiefComplaint: 'Fever and headache for 3 days' });
      expect(c.status).toBe(201);
      cid = c.body.data._id;
      expect((await t(S, doctor).post(`/api/v1/consultations/${cid}/finalize`)).body.error.code).toBe('CONSULTATION_INCOMPLETE');
      await t(S, doctor).patch(`/api/v1/consultations/${cid}`).send({ examination: 'Febrile, neck soft', diagnoses: [{ code: '1F40', display: 'Malaria', system: 'ICD-11' }], plan: 'Antimalarials' });
      expect((await t(S, doctor2).patch(`/api/v1/consultations/${cid}`).send({ plan: 'x' })).status).toBe(403);
      expect((await t(S, doctor2).post(`/api/v1/consultations/${cid}/finalize`)).status).toBe(403);
      const f = await t(S, doctor).post(`/api/v1/consultations/${cid}/finalize`);
      expect(f.body.data.status).toBe('final');
      expect((await t(S, doctor).patch(`/api/v1/consultations/${cid}`).send({ plan: 'changed' })).body.error.code).toBe('CONSULTATION_FINALIZED');
      const a = await t(S, doctor).post(`/api/v1/consultations/${cid}/addenda`).send({ text: 'RDT positive confirmed', reason: 'Late lab result' });
      expect(a.body.data.addenda).toHaveLength(1);
      expect(a.body.data.plan).toBe('Antimalarials');
    });

    it('suggests diagnoses from facility history and shows the visit summary', async () => {
      const d = await t(S, doctor).get('/api/v1/opd/diagnoses/search?q=mala');
      expect(d.body.data[0]).toEqual(expect.objectContaining({ code: '1F40', display: 'Malaria' }));
      expect(d.body.source).toBe('facility_history');
      const v = await t(S, doctor).get(`/api/v1/visits/${visitId}`);
      expect(v.body.data.consultations).toHaveLength(1);
      expect(v.body.data.vitals).toHaveLength(1);
      const s = await t(S, doctor).get(`/api/v1/opd/patients/${patientId}/summary`);
      expect(s.body.data.diagnoses[0].display).toBe('Malaria');
    });

    it('closes the visit', async () => {
      const r = await t(S, doctor).post(`/api/v1/visits/${visitId}/close`);
      expect(r.body.data.status).toBe('closed');
    });
  });
});

describe('appointments', () => {
  it('books, detects clashes and queues SMS confirmation + reminder', async () => {
    const users = await t(S, admin).get('/api/v1/users?q=doc@clin');
    const providerId = users.body.data[0]._id;
    const when = new Date(Date.now() + 3 * 86400_000);
    const a = await t(S, reception).post('/api/v1/appointments').send({ patientId, scheduledAt: when, providerId, reason: 'Review' });
    expect(a.status).toBe(201);
    const clash = await t(S, reception).post('/api/v1/appointments').send({ patientId, scheduledAt: new Date(when.getTime() + 5 * 60_000), providerId });
    expect(clash.body.error.code).toBe('APPOINTMENT_CLASH');
    const jobs = await meta().Job.find({ type: 'SMS', idempotencyKey: new RegExp(String(a.body.data._id)) }).lean();
    expect(jobs).toHaveLength(2);
    const checkIn = await t(S, reception).post('/api/v1/visits').send({ patientId, appointmentId: a.body.data._id });
    expect(checkIn.status).toBe(201);
    const list = await t(S, reception).get(`/api/v1/appointments?patientId=${patientId}`);
    expect(list.body.data[0].status).toBe('checked_in');
  });

  it('books by service into a free slot, shows taken slots, and refuses double-booking the patient', async () => {
    await t(S, admin).post('/api/v1/billing/services').send({ code: 'PHYSIO', name: 'Physiotherapy session', category: 'procedure', prices: [{ priceList: 'cash', amount: 1500 }] });
    const services = await t(S, reception).get('/api/v1/appointments/services');
    expect(services.body.data.map((x: { code: string }) => x.code)).toContain('PHYSIO');
    const providerId = (await t(S, admin).get('/api/v1/users?q=doc2@clin')).body.data[0]._id;
    const day = new Date(Date.now() + 10 * 86400_000 + 3 * 3600_000).toISOString().slice(0, 10); // EAT date
    const at10 = new Date(Date.parse(`${day}T10:00:00+03:00`));
    expect((await t(S, reception).post('/api/v1/appointments').send({ patientId, scheduledAt: at10 })).body.error.message).toBe('Choose a service or a practitioner');
    const svc = await t(S, reception).post('/api/v1/appointments').send({ patientId, scheduledAt: at10, serviceCode: 'physio', providerId, durationMinutes: 30 });
    expect(svc.status).toBe(201);
    expect(svc.body.data).toMatchObject({ bookBy: 'service', serviceCode: 'PHYSIO', serviceName: 'Physiotherapy session' });
    const slots = (await t(S, reception).get('/api/v1/appointments/slots').query({ date: day, durationMinutes: 30, providerId })).body.data;
    expect(slots.slots[0].label).toBe('08:00');
    expect(slots.slots.at(-1).label).toBe('16:30');
    expect(slots.slots.find((x: { label: string }) => x.label === '10:00')).toMatchObject({ available: false, reason: 'practitioner booked' });
    expect(slots.slots.find((x: { label: string }) => x.label === '10:30').available).toBe(true);
    // Same patient, another practitioner, overlapping time.
    const doc1 = (await t(S, admin).get('/api/v1/users?q=doc@clin')).body.data[0]._id;
    expect((await t(S, reception).post('/api/v1/appointments').send({ patientId, scheduledAt: new Date(at10.getTime() + 15 * 60_000), providerId: doc1 })).body.error.code).toBe('PATIENT_DOUBLE_BOOKED');
  });

  it('books a course all-or-nothing, and lists by tab, search and export', async () => {
    const day = new Date(Date.now() + 20 * 86400_000 + 3 * 3600_000).toISOString().slice(0, 10);
    const first = new Date(Date.parse(`${day}T09:00:00+03:00`));
    const course = await t(S, reception).post('/api/v1/appointments/course').send({ patientId, scheduledAt: first, serviceCode: 'PHYSIO', sessions: 4, everyDays: 7, durationMinutes: 30 });
    expect(course.status).toBe(201);
    expect(course.body.data.appointments.map((x: { courseIndex: number; courseTotal: number }) => `${x.courseIndex}/${x.courseTotal}`)).toEqual(['1/4', '2/4', '3/4', '4/4']);
    // A second course overlapping session 2 books nothing at all.
    const before = (await t(S, reception).get('/api/v1/appointments').query({ scope: 'upcoming', patientId })).body.data.length;
    const clash = await t(S, reception).post('/api/v1/appointments/course').send({ patientId, scheduledAt: new Date(first.getTime() + 7 * 86400_000), serviceCode: 'PHYSIO', sessions: 3, everyDays: 1, durationMinutes: 30 });
    expect(clash.body.error.code).toBe('COURSE_CLASH');
    expect(clash.body.error.message).toMatch(/^Nothing was booked\. 1 session\(s\) clash/);
    expect((await t(S, reception).get('/api/v1/appointments').query({ scope: 'upcoming', patientId })).body.data).toHaveLength(before);
    const up = await t(S, reception).get('/api/v1/appointments').query({ scope: 'upcoming', q: 'Queue' });
    expect(up.body.data.length).toBeGreaterThanOrEqual(4);
    expect(new Date(up.body.data[0].scheduledAt) <= new Date(up.body.data[1].scheduledAt)).toBe(true);
    expect((await t(S, reception).get('/api/v1/appointments').query({ scope: 'past', q: 'Queue' })).body.data).toHaveLength(0);
    const csv = await t(S, reception).get('/api/v1/appointments/export').query({ scope: 'upcoming', serviceCode: 'PHYSIO' });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\r\n')).toHaveLength(1 + 5);
    expect(csv.text).toContain('Physiotherapy session');
  });
});
