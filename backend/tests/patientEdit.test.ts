import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHie, createFacility, ownerToken, setupApp, startHieStub, t, teardown, tenantLogin } from './helpers';

const S = 'editfac';
let admin = '';
let stub: Awaited<ReturnType<typeof startHieStub>>;
let id = '';
let other = '';

beforeAll(async () => {
  await setupApp();
  stub = await startHieStub();
  const owner = await ownerToken();
  await configureHie(owner, stub.baseUrl);
  const F = await createFacility(owner, S);
  admin = (await tenantLogin(S, F.admin.email)).token;
  id = (await t(S, admin).post('/api/v1/patients').send({ firstName: 'Amina', lastName: 'Hassan', gender: 'female', phone: '0712000111', nationalId: '11112222' })).body.data._id;
  other = (await t(S, admin).post('/api/v1/patients').send({ firstName: 'Baraka', lastName: 'Otieno', gender: 'male', nationalId: '33334444' })).body.data._id;
});
afterAll(async () => {
  await stub.close();
  await teardown();
});

describe('editing a patient', () => {
  it('updates every demographic section and records it in the history', async () => {
    const r = await t(S, admin).patch(`/api/v1/patients/${id}`).send({
      firstName: 'Amina', middleName: 'Wanjiru', lastName: 'Hassan-Ali', gender: 'female', dateOfBirth: '1992-03-14', dobEstimated: false,
      maritalStatus: 'Married', occupation: 'Teacher', nationality: 'Kenyan', phone: '0722 333 444', altPhone: '0733444555', email: 'amina@example.test',
      nationalId: '11112222', shaNumber: 'SHA-778899',
      identifiers: [{ type: 'National ID', value: '11112222' }, { type: 'SHA Number', value: 'SHA-778899' }, { type: 'Passport', value: 'AK123456' }],
      address: { county: 'Nakuru', subCounty: 'Naivasha', ward: 'Hells Gate', village: 'Kongoni', physicalAddress: 'Moi South Lake Rd' },
      nextOfKin: [{ name: 'Hassan Ali', relationship: 'Spouse', phone: '0711222333', idNumber: '22223333' }],
      allergies: [{ substance: 'Penicillin', reaction: 'Rash', severity: 'moderate' }],
      consent: { sms: false, dataSharing: true },
    });
    expect(r.status).toBe(200);
    const p = (await t(S, admin).get(`/api/v1/patients/${id}`)).body.data;
    expect(p).toMatchObject({ middleName: 'Wanjiru', lastName: 'Hassan-Ali', maritalStatus: 'Married', occupation: 'Teacher', phone: '254722333444', altPhone: '254733444555', shaNumber: 'SHA-778899', address: { county: 'Nakuru', village: 'Kongoni' }, consent: { sms: false, dataSharing: true } });
    expect(p.dateOfBirth.slice(0, 10)).toBe('1992-03-14');
    expect(p.nextOfKin[0]).toMatchObject({ name: 'Hassan Ali', idNumber: '22223333' });
    expect(p.allergies[0]).toMatchObject({ substance: 'Penicillin', severity: 'moderate' });
    expect(p.identifiers.map((i: { type: string }) => i.type)).toEqual(expect.arrayContaining(['National ID', 'SHA Number', 'Passport']));
    const timeline = (await t(S, admin).get(`/api/v1/patients/${id}/timeline`)).body.data;
    expect(timeline.some((e: { title: string }) => e.title === 'Demographics updated')).toBe(true);
  });

  it('clears blanked fields instead of storing empty strings', async () => {
    await t(S, admin).patch(`/api/v1/patients/${id}`).send({ middleName: '', email: '', altPhone: '', shaNumber: '' });
    const p = (await t(S, admin).get(`/api/v1/patients/${id}`)).body.data;
    expect(p.middleName).toBeUndefined();
    expect(p.email).toBeUndefined();
    expect(p.altPhone).toBeUndefined();
    expect(p.shaNumber).toBeUndefined();
    // the SHA number also left the identifier list
    expect(p.identifiers.some((i: { type: string }) => i.type === 'SHA Number')).toBe(false);
  });

  it('refuses a future date of birth, a bad national ID, and another patient\'s ID', async () => {
    const future = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    expect((await t(S, admin).patch(`/api/v1/patients/${id}`).send({ dateOfBirth: future })).status).toBe(400);
    expect((await t(S, admin).patch(`/api/v1/patients/${id}`).send({ nationalId: '12ab' })).status).toBe(400);
    const dup = await t(S, admin).patch(`/api/v1/patients/${id}`).send({ nationalId: '33334444' });
    expect(dup.body.error.code).toBe('PATIENT_EXISTS');
    expect(other).toBeTruthy();
  });

  it('keeps registry names and date of birth locked for a patient imported from DHA, but allows contact edits', async () => {
    const imp = await t(S, admin).post('/api/v1/patients/import-dha').send({ identificationType: 'National ID', identificationNumber: '12345678', consent: { dataSharing: true } });
    expect(imp.status).toBe(201);
    const pid = imp.body.data._id;
    expect((await t(S, admin).patch(`/api/v1/patients/${pid}`).send({ firstName: 'JAMES' })).body.error.code).toBe('REGISTRY_FIELDS_LOCKED');
    expect((await t(S, admin).patch(`/api/v1/patients/${pid}`).send({ dateOfBirth: '1991-01-01' })).body.error.code).toBe('REGISTRY_FIELDS_LOCKED');
    // Re-sending the same values (as a full form does) is fine.
    expect((await t(S, admin).patch(`/api/v1/patients/${pid}`).send({ firstName: 'JOHN', dateOfBirth: '1990-01-12', phone: '0799000111', address: { county: 'Mandera', ward: 'Township' } })).status).toBe(200);
    const p = (await t(S, admin).get(`/api/v1/patients/${pid}`)).body.data;
    expect(p).toMatchObject({ firstName: 'JOHN', phone: '254799000111', address: { ward: 'Township' } });
  });
});
