import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFacility, createUser, ownerToken, setupApp, t, teardown, tenantLogin } from './helpers';
import { eddFromLmp, partographAlerts } from '../src/modules/maternity/obstetrics';
import { meta } from '../src/models/meta';
import { IntegrationSecretService } from '../src/modules/integrations/secretService';

const S = 'wardfac';
let admin: string;
let doctor: string;
let nurse: string;
let midwife: string;
let mchNurse: string;
let dentist: string;
let mortuary: string;
let branchId: string;

const mk = async (body: object) => (await t(S, admin).post('/api/v1/patients').send(body)).body.data._id as string;

beforeAll(async () => {
  await setupApp();
  const owner = await ownerToken();
  const F = await createFacility(owner, S);
  branchId = F.branches[0].id;
  admin = (await tenantLogin(S, F.admin.email)).token;
  const b = [branchId];
  doctor = await createUser(S, admin, { email: 'doc@w.test', roleKey: 'doctor', branchAccess: 'specific', branchIds: b });
  nurse = await createUser(S, admin, { email: 'nurse@w.test', roleKey: 'nurse', branchAccess: 'specific', branchIds: b });
  midwife = await createUser(S, admin, { email: 'mw@w.test', roleKey: 'maternity_nurse', branchAccess: 'specific', branchIds: b });
  mchNurse = await createUser(S, admin, { email: 'mch@w.test', roleKey: 'mch_nurse', branchAccess: 'specific', branchIds: b });
  dentist = await createUser(S, admin, { email: 'dent@w.test', roleKey: 'dentist', branchAccess: 'specific', branchIds: b });
  mortuary = await createUser(S, admin, { email: 'mort@w.test', roleKey: 'mortuary_officer', branchAccess: 'specific', branchIds: b });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'BED-GEN', name: 'General ward bed day', category: 'bed', prices: [{ priceList: 'cash', amount: 1500 }] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'MORT-STORAGE', name: 'Mortuary storage per day', category: 'mortuary', prices: [{ priceList: 'cash', amount: 1000 }] });
  await t(S, admin).post('/api/v1/billing/services').send({ code: 'DENT-EXT', name: 'Tooth extraction', category: 'dental', prices: [{ priceList: 'cash', amount: 1200 }] });
});
afterAll(teardown);

describe('inpatient', () => {
  let wardId: string;
  let beds: Array<{ _id: string; number: string }>;
  let admissionId: string;
  let p1: string;
  it('configures wards and beds', async () => {
    expect((await t(S, doctor).post('/api/v1/inpatient/wards').send({ name: 'Male Medical', code: 'MMW' })).status).toBe(403);
    const w = await t(S, admin).post('/api/v1/inpatient/wards').send({ name: 'Male Medical', code: 'MMW', bedChargeServiceCode: 'BED-GEN', gender: 'male' });
    wardId = w.body.data._id;
    const b = await t(S, admin).post(`/api/v1/inpatient/wards/${wardId}/beds`).send({ numbers: ['1', '2', '3'] });
    beds = b.body.data;
    expect(beds).toHaveLength(3);
  });

  it('admits atomically: a bed cannot be double-booked', async () => {
    p1 = await mk({ firstName: 'In', lastName: 'Patient', gender: 'male' });
    const p2 = await mk({ firstName: 'Other', lastName: 'Patient', gender: 'male' });
    const a = await t(S, doctor).post('/api/v1/inpatient/admissions').send({ patientId: p1, bedId: beds[0]._id, admissionDiagnosis: 'Severe pneumonia', phoneVerification: { skipReason: 'patient_unable' } });
    expect(a.status).toBe(201);
    admissionId = a.body.data._id;
    const clash = await t(S, doctor).post('/api/v1/inpatient/admissions').send({ patientId: p2, bedId: beds[0]._id, admissionDiagnosis: 'Malaria', phoneVerification: { skipReason: 'patient_unable' } });
    expect(clash.body.error.code).toBe('BED_UNAVAILABLE');
    expect((await t(S, doctor).post('/api/v1/inpatient/admissions').send({ patientId: p1, bedId: beds[1]._id, admissionDiagnosis: 'x y', phoneVerification: { skipReason: 'patient_unable' } })).body.error.code).toBe('ALREADY_ADMITTED');
    const occ = await t(S, nurse).get('/api/v1/inpatient/occupancy');
    expect(occ.body.data).toEqual(expect.objectContaining({ total: 3, occupied: 1, occupancyRate: 33.3 }));
  });

  it('records nursing notes, MAR, fluids and vitals with role separation', async () => {
    expect((await t(S, nurse).post(`/api/v1/inpatient/admissions/${admissionId}/notes`).send({ kind: 'doctor_round', text: 'Improving' })).status).toBe(403);
    expect((await t(S, nurse).post(`/api/v1/inpatient/admissions/${admissionId}/notes`).send({ kind: 'nursing', text: 'Comfortable overnight' })).status).toBe(201);
    expect((await t(S, doctor).post(`/api/v1/inpatient/admissions/${admissionId}/notes`).send({ kind: 'doctor_round', text: 'Chest clearer, continue IV antibiotics' })).status).toBe(201);
    expect((await t(S, nurse).post(`/api/v1/inpatient/admissions/${admissionId}/mar`).send({ drugName: 'Ceftriaxone 1g', status: 'held' })).status).toBe(400);
    expect((await t(S, nurse).post(`/api/v1/inpatient/admissions/${admissionId}/mar`).send({ drugName: 'Ceftriaxone 1g', dose: '1g', route: 'IV', status: 'given' })).status).toBe(201);
    await t(S, nurse).post(`/api/v1/inpatient/admissions/${admissionId}/fluids`).send({ direction: 'intake', route: 'IV', volumeMl: 1000 });
    await t(S, nurse).post(`/api/v1/inpatient/admissions/${admissionId}/fluids`).send({ direction: 'output', route: 'Urine', volumeMl: 600 });
    await t(S, nurse).post('/api/v1/opd/vitals').send({ admissionId, temperatureC: 37.8, pulse: 96 });
    const d = await t(S, nurse).get(`/api/v1/inpatient/admissions/${admissionId}`);
    expect(d.body.data.fluidBalance24h).toEqual({ intake: 1000, output: 600, net: 400 });
    expect(d.body.data.notes).toHaveLength(2);
    expect(d.body.data.vitals).toHaveLength(1);
  });

  it('transfers and discharges with bed-day charges; the bed goes to cleaning', async () => {
    const tr = await t(S, doctor).post(`/api/v1/inpatient/admissions/${admissionId}/transfer`).send({ toBedId: beds[2]._id, reason: 'Moved nearer nursing station' });
    expect(tr.status).toBe(200);
    const dis = await t(S, doctor).post(`/api/v1/inpatient/admissions/${admissionId}/discharge`).send({ outcome: 'recovered', summary: 'Treated for severe pneumonia with IV ceftriaxone.', finalDiagnosis: 'Community acquired pneumonia', followUp: 'Review in 1 week' });
    expect(dis.body.data.status).toBe('discharged');
    expect(dis.body.data.bedDaysCharged).toBe(1);
    const beds2 = await t(S, nurse).get(`/api/v1/inpatient/beds?wardId=${wardId}`);
    expect(beds2.body.data.find((b: { _id: string }) => b._id === beds[2]._id).status).toBe('cleaning');
    const inv = await t(S, admin).get(`/api/v1/billing/invoices?patientId=${p1}`);
    expect(inv.body.data[0].totals.gross).toBe(1500);
  });
});

describe('maternity', () => {
  it('computes EDD by Naegele and partograph alert/action lines', () => {
    expect(eddFromLmp(new Date('2026-01-01')).toISOString().slice(0, 10)).toBe('2026-10-08');
    const start = new Date('2026-09-01T00:00:00Z');
    expect(partographAlerts({ at: new Date('2026-09-01T03:00:00Z'), cervicalDilationCm: 6 }, start)).toEqual(['Alert line crossed — slow progress']);
    expect(partographAlerts({ at: new Date('2026-09-01T09:00:00Z'), cervicalDilationCm: 7 }, start)[0]).toMatch(/^ACTION LINE/);
    expect(partographAlerts({ at: new Date('2026-09-01T02:00:00Z'), cervicalDilationCm: 6, fetalHeartRate: 100 }, start)).toEqual(['Abnormal fetal heart rate']);
  });

  it('runs ANC → labour → delivery with newborn registration and mother–baby linkage', async () => {
    const mother = await mk({ firstName: 'Halima', lastName: 'Ali', gender: 'female', dateOfBirth: '2010-05-01', phone: '0711222333' });
    const lmp = new Date(Date.now() - 38 * 7 * 86400_000);
    const p = await t(S, midwife).post('/api/v1/maternity/pregnancies').send({ patientId: mother, lmp, gravida: 2, para: 1, obstetricHistory: [{ year: 2024, outcome: 'live birth', mode: 'C-section' }] });
    expect(p.status).toBe(201);
    expect(p.body.data.riskLevel).toBe('high');
    expect(p.body.data.riskFactors).toEqual(expect.arrayContaining(['Adolescent pregnancy (<18)', 'Previous caesarean section']));
    expect(p.body.data.gestation.weeks).toBe(38);
    const pid = p.body.data._id;
    expect((await t(S, midwife).post('/api/v1/maternity/pregnancies').send({ patientId: mother, gravida: 3, para: 1 })).body.error.code).toBe('PREGNANCY_ACTIVE');
    const anc = await t(S, midwife).post(`/api/v1/maternity/pregnancies/${pid}/anc`).send({ systolic: 150, diastolic: 95, urineProtein: '++', haemoglobin: 9.5, fetalHeartRate: 140 });
    expect(anc.body.data.flags).toEqual(expect.arrayContaining(['Hypertension in pregnancy — assess for pre-eclampsia', 'Proteinuria with hypertension', 'Anaemia (Hb < 11)']));
    expect(anc.body.data.contactNumber).toBe(1);
    const l = await t(S, midwife).post(`/api/v1/maternity/pregnancies/${pid}/labour`).send({});
    const now = Date.now();
    await t(S, midwife).post(`/api/v1/maternity/labour/${l.body.data._id}/partograph`).send({ at: new Date(now - 6 * 3600_000), cervicalDilationCm: 4, fetalHeartRate: 140 });
    const late = await t(S, midwife).post(`/api/v1/maternity/labour/${l.body.data._id}/partograph`).send({ at: new Date(now), cervicalDilationCm: 5, fetalHeartRate: 150 });
    expect(late.body.data.alerts[0]).toMatch(/^ACTION LINE/); // 4→5 cm in 6 h is past the action line
    expect((await t(S, midwife).post(`/api/v1/maternity/pregnancies/${pid}/delivery`).send({ deliveredAt: new Date(), mode: 'c_section', babies: [{ sex: 'female', birthWeightGrams: 3100 }] })).status).toBe(400);
    const d = await t(S, midwife).post(`/api/v1/maternity/pregnancies/${pid}/delivery`).send({ deliveredAt: new Date(), mode: 'c_section', cSection: { indication: 'Prolonged labour, previous CS', type: 'emergency' }, bloodLossMl: 600, babies: [{ sex: 'female', birthWeightGrams: 2300, apgar1: 6, apgar5: 8 }, { sex: 'male', birthWeightGrams: 1900, outcome: 'fresh_stillbirth' }] });
    expect(d.status).toBe(201);
    expect(d.body.data.flags).toEqual(expect.arrayContaining(['Low birth weight (<2500g)', 'Postpartum haemorrhage (≥500 ml)']));
    const baby = d.body.data.delivery.babies[0];
    expect(baby.newbornPatientId).toBeDefined();
    expect(d.body.data.delivery.babies[1].newbornPatientId).toBeUndefined();
    const bp = await t(S, admin).get(`/api/v1/patients/${baby.newbornPatientId}`);
    expect(bp.body.data).toEqual(expect.objectContaining({ firstName: 'Baby A', lastName: 'of Halima Ali', motherId: mother, gender: 'female' }));
    const detail = await t(S, midwife).get(`/api/v1/maternity/pregnancies/${pid}`);
    expect(detail.body.data.pregnancy.status).toBe('delivered');
    expect(detail.body.data.labour.status).toBe('delivered');
  });
});

describe('MCH & family planning', () => {
  it('tracks KEPI schedule, prevents duplicate doses, classifies MUAC and lists defaulters', async () => {
    const dob = new Date(Date.now() - 120 * 86400_000);
    const child = await mk({ firstName: 'Little', lastName: 'One', gender: 'male', dateOfBirth: dob, phone: '0700999888' });
    await t(S, mchNurse).post('/api/v1/mch/immunizations').send({ patientId: child, vaccine: 'BCG', dose: 1, givenAt: dob });
    const opv = await t(S, mchNurse).post('/api/v1/mch/immunizations').send({ patientId: child, vaccine: 'OPV', dose: 1 });
    expect(opv.body.data.nextDue).toBeDefined();
    expect((await t(S, mchNurse).post('/api/v1/mch/immunizations').send({ patientId: child, vaccine: 'OPV', dose: 1 })).body.error.code).toBe('DUPLICATE_DOSE');
    const s = await t(S, mchNurse).get(`/api/v1/mch/patients/${child}/immunizations`);
    const status = (v: string, d: number) => s.body.data.schedule.find((x: { vaccine: string; dose: number }) => x.vaccine === v && x.dose === d).status;
    expect(status('BCG', 1)).toBe('given');
    expect(status('OPV', 0)).toBe('overdue');
    expect(status('Measles-Rubella', 1)).toBe('upcoming');
    const def = await t(S, mchNurse).get('/api/v1/mch/defaulters');
    expect(def.body.data.find((r: { patient: { _id: string } }) => r.patient._id === child).overdue).toEqual(expect.arrayContaining(['OPV 0', 'Pentavalent (DPT-HepB-Hib) 1']));
    const g = await t(S, mchNurse).post('/api/v1/mch/growth').send({ patientId: child, weightKg: 5.1, muacCm: 11.2 });
    expect(g.body.data.nutritionStatus).toBeUndefined(); // MUAC classification applies from 6 months
  });

  it('family planning sets return dates by method and validates eligibility', async () => {
    const client = await mk({ firstName: 'Fp', lastName: 'Client', gender: 'female' });
    const v = await t(S, mchNurse).post('/api/v1/family-planning/visits').send({ patientId: client, method: 'injectable_dmpa', counselling: 'Discussed side effects' });
    expect(Math.round((new Date(v.body.data.nextDue).getTime() - Date.now()) / 86400_000)).toBe(91);
    expect((await t(S, mchNurse).post('/api/v1/family-planning/visits').send({ patientId: client, method: 'vasectomy' })).status).toBe(400);
  });
});

describe('dental', () => {
  it('validates FDI tooth numbers, bills completed treatment and updates the chart', async () => {
    const p = await mk({ firstName: 'Dental', lastName: 'Patient', gender: 'female' });
    expect((await t(S, dentist).put(`/api/v1/dental/patients/${p}/chart`).send({ teeth: { '19': { status: 'caries' } } })).status).toBe(400);
    await t(S, dentist).put(`/api/v1/dental/patients/${p}/chart`).send({ teeth: { '36': { status: 'caries', surfaces: ['O', 'D'] } } });
    const v = await t(S, dentist).post('/api/v1/dental/visits').send({ patientId: p, diagnosis: 'Irreversible pulpitis 36', treatmentPlan: [{ tooth: '36', procedure: 'Extraction', serviceCode: 'DENT-EXT' }] });
    const done = await t(S, dentist).post(`/api/v1/dental/visits/${v.body.data._id}/plan/${v.body.data.treatmentPlan[0]._id}/done`);
    expect(done.body.data.treatmentPlan[0].status).toBe('done');
    const chart = await t(S, dentist).get(`/api/v1/dental/patients/${p}/chart`);
    expect(chart.body.data.teeth['36'].status).toBe('extracted');
    const inv = await t(S, admin).get(`/api/v1/billing/invoices?patientId=${p}`);
    expect(inv.body.data[0].totals.gross).toBe(1200);
  });
});

describe('mortuary', () => {
  it('requires the bill to be settled before authorizing release, and matching ID at release', async () => {
    const c = await t(S, mortuary).post('/api/v1/mortuary/cases').send({ deceased: { name: 'John Unknown', sex: 'male' }, dateOfDeath: new Date(), placeOfDeath: 'brought_in_dead', storage: { chamber: 'A', tray: '1' }, nextOfKin: [{ name: 'Jane Unknown', relationship: 'Wife', phone: '0711000000', idNumber: '12345678' }] });
    expect(c.status).toBe(201);
    expect(c.body.data.mortuaryNumber).toMatch(/^MRT-/);
    expect((await t(S, mortuary).post('/api/v1/mortuary/cases').send({ deceased: { name: 'Another' }, dateOfDeath: new Date(), storage: { chamber: 'A', tray: '1' } })).body.error.code).toBe('STORAGE_OCCUPIED');
    const id = c.body.data._id;
    expect((await t(S, mortuary).post(`/api/v1/mortuary/cases/${id}/authorize-release`).send({ releaseTo: 'Jane Unknown', releaseToIdNumber: '12345678', burialPermitNumber: 'BP-1' })).status).toBe(403);
    const blocked = await t(S, admin).post(`/api/v1/mortuary/cases/${id}/authorize-release`).send({ releaseTo: 'Jane Unknown', releaseToIdNumber: '12345678', burialPermitNumber: 'BP-1' });
    expect(blocked.body.error.code).toBe('MORTUARY_BILL_OUTSTANDING');
    await t(S, admin).post('/api/v1/billing/payments').send({ invoiceId: blocked.body.error.details.invoiceId, method: 'cash', amount: 1000, idempotencyKey: 'mort-pay-0001' });
    const ok = await t(S, admin).post(`/api/v1/mortuary/cases/${id}/authorize-release`).send({ releaseTo: 'Jane Unknown', releaseToIdNumber: '12345678', burialPermitNumber: 'BP-1' });
    expect(ok.body.data.status).toBe('release_authorized');
    expect((await t(S, mortuary).post(`/api/v1/mortuary/cases/${id}/release`).send({ releaseToIdNumber: '99999999' })).body.error.code).toBe('ID_MISMATCH');
    expect((await t(S, mortuary).post(`/api/v1/mortuary/cases/${id}/release`).send({ releaseToIdNumber: '12345678' })).body.data.status).toBe('released');
  });
});

describe('admission phone verification', () => {
  let otpWard: string;
  let otpBeds: Array<{ _id: string }>;
  const admit = (patientId: string, bed: number, phoneVerification?: unknown) => t(S, doctor).post('/api/v1/inpatient/admissions').send({ patientId, bedId: otpBeds[bed]._id, admissionDiagnosis: 'Observation', ...(phoneVerification ? { phoneVerification } : {}) });
  const lastCode = async (to: string) => {
    const job = await meta().Job.findOne({ type: 'SMS', 'payload.to': to }).sort({ createdAt: -1, _id: -1 }).lean();
    const p = job!.payload as { message?: string; messageEnc?: never };
    expect(p.message).toBeUndefined(); // never stored in plain text
    return /is (\d{6})\./.exec(IntegrationSecretService.decrypt(p.messageEnc!))![1];
  };

  beforeAll(async () => {
    otpWard = (await t(S, admin).post('/api/v1/inpatient/wards').send({ name: 'Observation', code: 'OBS', bedChargeServiceCode: 'BED-GEN' })).body.data._id;
    otpBeds = (await t(S, admin).post(`/api/v1/inpatient/wards/${otpWard}/beds`).send({ numbers: ['O1', 'O2', 'O3', 'O4', 'O5'] })).body.data;
  });

  it('requires a phone code or a recorded reason before admitting', async () => {
    const p = await mk({ firstName: 'Needs', lastName: 'Code', gender: 'female', phone: '0712000555' });
    const r = await admit(p, 0);
    expect(r.body.error.code).toBe('PHONE_VERIFICATION_REQUIRED');
    const info = (await t(S, doctor).get(`/api/v1/inpatient/admissions/phone-verification?patientId=${p}`)).body.data;
    expect(info.policy).toBe('required');
    expect(info.options[0]).toMatchObject({ target: 'patient', label: 'Patient', phoneMasked: '2547*****555' });
    expect(info.skipReasons.map((x: { key: string }) => x.key)).toContain('patient_unable');
    expect((await admit(p, 0, { skipReason: 'other' })).body.error.message).toMatch(/Explain why/);
  });

  it('sends a code by SMS, checks it, and admits once with the verification', async () => {
    const p = await mk({ firstName: 'Verified', lastName: 'Phone', gender: 'male', phone: '0712000666' });
    const other = await mk({ firstName: 'Someone', lastName: 'Else', gender: 'male', phone: '0712000667' });
    const sent = await t(S, doctor).post('/api/v1/inpatient/admissions/phone-otp').send({ patientId: p, target: 'patient' });
    expect(sent.status).toBe(201);
    expect(sent.body.data.sentTo).toBe('2547*****666');
    expect((await t(S, doctor).post('/api/v1/inpatient/admissions/phone-otp').send({ patientId: p })).body.error.code).toBe('OTP_RESEND_TOO_SOON');
    const code = await lastCode('254712000666');
    const wrong = await t(S, doctor).post(`/api/v1/inpatient/admissions/phone-otp/${sent.body.data.otpId}/verify`).send({ code: code === '000000' ? '111111' : '000000' });
    expect(wrong.body.error).toMatchObject({ code: 'OTP_INVALID', message: expect.stringMatching(/4 tries left/) });
    // only the staff member who sent the code can check it
    expect((await t(S, nurse).post(`/api/v1/inpatient/admissions/phone-otp/${sent.body.data.otpId}/verify`).send({ code })).status).toBe(403);
    const ok = await t(S, doctor).post(`/api/v1/inpatient/admissions/phone-otp/${sent.body.data.otpId}/verify`).send({ code });
    expect(ok.status).toBe(200);
    const token = ok.body.data.verificationToken;
    expect((await admit(other, 1, { token })).body.error.code).toBe('PHONE_VERIFICATION_INVALID');
    const a = await admit(p, 1, { token });
    expect(a.status).toBe(201);
    expect(a.body.data.phoneVerification).toMatchObject({ status: 'verified', method: 'sms_code', target: 'patient', phoneMasked: '2547*****666' });
    expect((await t(S, doctor).post(`/api/v1/inpatient/admissions/phone-otp/${sent.body.data.otpId}/verify`).send({ code })).body.error.code).toBe('NOT_FOUND');
    const stored = await meta().Job.find({ type: 'SMS', 'payload.to': '254712000666' }).lean();
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  it('can verify a new number and save it to the patient, or record a reason instead', async () => {
    const p = await mk({ firstName: 'No', lastName: 'Phone', gender: 'male' });
    expect((await t(S, doctor).get(`/api/v1/inpatient/admissions/phone-verification?patientId=${p}`)).body.data.options).toEqual([]);
    const sent = await t(S, doctor).post('/api/v1/inpatient/admissions/phone-otp').send({ patientId: p, target: 'other', phone: '+254 722 000 777', savePhone: true });
    const code = await lastCode('254722000777');
    const token = (await t(S, doctor).post(`/api/v1/inpatient/admissions/phone-otp/${sent.body.data.otpId}/verify`).send({ code })).body.data.verificationToken;
    expect((await admit(p, 2, { token })).status).toBe(201);
    expect((await t(S, doctor).get(`/api/v1/patients/${p}`)).body.data.phone).toBe('254722000777');

    const q = await mk({ firstName: 'Unconscious', lastName: 'Patient', gender: 'female' });
    const r = await admit(q, 3, { skipReason: 'patient_unable' });
    expect(r.status).toBe(201);
    expect(r.body.data.phoneVerification).toMatchObject({ status: 'skipped', skipReason: 'Patient unconscious or unable to respond (emergency)' });
  });

  it('follows the facility setting', async () => {
    expect((await t(S, admin).put('/api/v1/admin/settings/admissionPhoneVerification').send({ value: 'sometimes' })).status).toBe(400);
    expect((await t(S, admin).put('/api/v1/admin/settings/admissionPhoneVerification').send({ value: 'off' })).status).toBe(200);
    const p = await mk({ firstName: 'Policy', lastName: 'Off', gender: 'male', phone: '0712000888' });
    const r = await admit(p, 4);
    expect(r.status).toBe(201);
    expect(r.body.data.phoneVerification.status).toBe('not_required');
    await t(S, admin).put('/api/v1/admin/settings/admissionPhoneVerification').send({ value: 'required' });
  });
});

describe('diagnosis catalog', () => {
  it('starts with common admission diagnoses (names only) and suggests them while typing', async () => {
    const list = (await t(S, doctor).get('/api/v1/diagnoses?admission=true')).body.data;
    expect(list.length).toBeGreaterThan(40);
    expect(list.every((d: { code?: string }) => !d.code)).toBe(true);
    const s = (await t(S, doctor).get('/api/v1/diagnoses/suggest?context=admission&q=malar')).body.data;
    expect(s.map((x: { display: string }) => x.display)).toEqual(expect.arrayContaining(['Severe malaria', 'Uncomplicated malaria']));
    // abbreviations match too
    expect((await t(S, doctor).get('/api/v1/diagnoses/suggest?context=admission&q=CVA')).body.data[0].display).toBe('Stroke');
    // recent admission diagnoses are suggested
    expect((await t(S, doctor).get('/api/v1/diagnoses/suggest?context=admission&q=pneumonia')).body.data.map((x: { display: string; source: string }) => `${x.source}:${x.display}`)).toEqual(expect.arrayContaining(['catalog:Severe pneumonia']));
  });

  it('lets administrators register diagnoses with codes, and feeds consultation search', async () => {
    expect((await t(S, doctor).post('/api/v1/diagnoses').send({ name: 'Essential hypertension' })).status).toBe(403);
    const r = await t(S, admin).post('/api/v1/diagnoses').send({ name: 'Essential hypertension', code: 'ba00', system: 'ICD-11', category: 'Cardiovascular', synonyms: ['HTN'] });
    expect(r.status).toBe(201);
    expect(r.body.data.code).toBe('BA00');
    expect((await t(S, admin).post('/api/v1/diagnoses').send({ name: 'essential  HYPERTENSION' })).body.error.code).toBe('DUPLICATE');
    const opd = (await t(S, doctor).get('/api/v1/opd/diagnoses/search?q=HTN')).body.data;
    expect(opd[0]).toMatchObject({ display: 'Essential hypertension', code: 'BA00', system: 'ICD-11', source: 'catalog' });
    expect((await t(S, admin).patch(`/api/v1/diagnoses/${r.body.data._id}`).send({ active: false })).status).toBe(200);
    expect((await t(S, doctor).get('/api/v1/diagnoses/suggest?q=HTN')).body.data).toEqual([]);
    expect((await t(S, admin).post('/api/v1/diagnoses').send({ name: 'X', code: 'bad code!' })).status).toBe(400);
  });
});
