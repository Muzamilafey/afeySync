/**
 * AfeySync → FHIR R4 (4.0.1) mappers.
 *
 * Profiles: Kenya Core FHIR IG (v1.0.0, FHIR 4.0.1) is the national foundation. Its canonical profile
 * URLs and national identifier systems MUST be taken from the published IG — they are configured per
 * facility (FacilitySetting `fhir.profiles` / `fhir.identifierSystems`) rather than hard-coded here.
 * Until configured, resources declare no meta.profile and identifiers use AfeySync's own namespace.
 */
type Obj = Record<string, unknown>;
export interface FhirConfig { base: string; profiles: Record<string, string>; systems: Record<string, string> }

const AFS = 'https://fhir.afeysync.com/sid';
export const defaultConfig = (tenantSlug: string): FhirConfig => ({
  base: `https://fhir.afeysync.com/${tenantSlug}`,
  profiles: {},
  systems: {
    patientNumber: `${AFS}/${tenantSlug}/patient-number`,
    visitNumber: `${AFS}/${tenantSlug}/visit-number`,
    'National ID': `${AFS}/national-id`,
    'ClientRegistry ID': `${AFS}/client-registry-id`,
    'SHA Number': `${AFS}/sha-number`,
    Passport: `${AFS}/passport`,
    'Birth Certificate': `${AFS}/birth-certificate`,
    'Birth Notification': `${AFS}/birth-notification`,
    'Alien ID': `${AFS}/alien-id`,
    'Refugee ID': `${AFS}/refugee-id`,
    'Mandate Number': `${AFS}/mandate-number`,
    practitionerLicense: `${AFS}/practitioner-license`,
    facilityCode: `${AFS}/facility-code`,
  },
});

const meta = (cfg: FhirConfig, type: string, lastUpdated?: Date | string | null) => {
  const m: Obj = {};
  if (cfg.profiles[type]) m.profile = [cfg.profiles[type]];
  if (lastUpdated) m.lastUpdated = new Date(lastUpdated).toISOString();
  return Object.keys(m).length ? m : undefined;
};
const date = (d?: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : undefined);
const dt = (d?: Date | string | null) => (d ? new Date(d).toISOString() : undefined);
/** Drops undefined values and empty arrays/objects (FHIR forbids empty elements). */
const prune = (v: unknown): unknown => {
  if (Array.isArray(v)) {
    const a = v.map(prune).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  if (v && typeof v === 'object') {
    const o = Object.fromEntries(Object.entries(v as Obj).map(([k, x]) => [k, prune(x)]).filter(([, x]) => x !== undefined && x !== null && x !== ''));
    return Object.keys(o).length ? o : undefined;
  }
  return v;
};
const clean = <T,>(o: T): T => (prune(JSON.parse(JSON.stringify(o))) ?? {}) as T;
const ref = (type: string, id: unknown, display?: string) => clean({ reference: `${type}/${String(id)}`, display });

export function toPatient(cfg: FhirConfig, p: Obj & { _id: unknown }) {
  const ids: Obj[] = [{ use: 'usual', system: cfg.systems.patientNumber, value: p.patientNumber }];
  if (p.nationalId) ids.push({ use: 'official', system: cfg.systems['National ID'], value: p.nationalId, type: { text: 'National ID' } });
  if (p.clientRegistryId) ids.push({ use: 'official', system: cfg.systems['ClientRegistry ID'], value: p.clientRegistryId, type: { text: 'ClientRegistry ID' } });
  if (p.shaNumber) ids.push({ system: cfg.systems['SHA Number'], value: p.shaNumber, type: { text: 'SHA Number' } });
  for (const i of (p.identifiers as Array<{ type: string; value: string }>) ?? []) if (!ids.some((x) => x.value === i.value)) ids.push({ system: cfg.systems[i.type] ?? `${AFS}/other`, value: i.value, type: { text: i.type } });
  const addr = p.address as Obj | undefined;
  return clean({
    resourceType: 'Patient',
    id: String(p._id),
    meta: meta(cfg, 'Patient', p.updatedAt as Date),
    identifier: ids,
    active: p.status !== 'inactive' && p.status !== 'merged',
    name: [{ use: 'official', family: p.lastName, given: [p.firstName, p.middleName].filter(Boolean), text: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') }],
    telecom: [p.phone && { system: 'phone', value: `+${String(p.phone).replace(/^\+/, '')}`, use: 'mobile' }, p.email && { system: 'email', value: p.email }].filter(Boolean),
    gender: ['male', 'female', 'other', 'unknown'].includes(p.gender as string) ? p.gender : 'unknown',
    birthDate: date(p.dateOfBirth as Date),
    deceasedDateTime: dt(p.deceasedAt as Date),
    address: addr && Object.values(addr).some(Boolean) ? [{ use: 'home', district: addr.subCounty, state: addr.county, line: [addr.ward, addr.village, addr.physicalAddress].filter(Boolean), country: 'KE' }] : undefined,
    link: p.mergedInto ? [{ other: ref('Patient', p.mergedInto), type: 'replaced-by' }] : undefined,
  });
}

export function toRelatedPersons(cfg: FhirConfig, p: Obj & { _id: unknown }) {
  return ((p.nextOfKin as Array<Obj>) ?? []).map((k, i) => clean({ resourceType: 'RelatedPerson', id: `${p._id}-nok-${i}`, meta: meta(cfg, 'RelatedPerson'), patient: ref('Patient', p._id), relationship: [{ text: k.relationship }], name: [{ text: k.name }], telecom: k.phone ? [{ system: 'phone', value: k.phone }] : undefined }));
}

export function toOrganization(cfg: FhirConfig, t: { id: string; name: string; facilityCode?: string | null; registryCode?: string | null; phone?: string | null; email?: string | null }) {
  return clean({ resourceType: 'Organization', id: t.id, meta: meta(cfg, 'Organization'), identifier: [t.facilityCode && { system: cfg.systems.facilityCode, value: t.facilityCode }, t.registryCode && { system: cfg.systems.facilityCode, value: t.registryCode, type: { text: 'Facility Registry Code' } }].filter(Boolean), active: true, type: [{ text: 'Healthcare provider' }], name: t.name, telecom: [t.phone && { system: 'phone', value: t.phone }, t.email && { system: 'email', value: t.email }].filter(Boolean) });
}

export function toLocation(cfg: FhirConfig, b: Obj & { _id: unknown }, orgId: string) {
  return clean({ resourceType: 'Location', id: String(b._id), meta: meta(cfg, 'Location'), identifier: b.facilityCode ? [{ system: cfg.systems.facilityCode, value: b.facilityCode }] : undefined, status: b.status === 'active' ? 'active' : 'suspended', name: b.branchName, mode: 'instance', telecom: [b.phone && { system: 'phone', value: b.phone }].filter(Boolean), address: { text: b.physicalAddress, district: b.subCounty, state: b.county, country: 'KE' }, position: b.latitude != null && b.longitude != null ? { latitude: b.latitude, longitude: b.longitude } : undefined, managingOrganization: ref('Organization', orgId) });
}

export function toPractitioner(cfg: FhirConfig, u: Obj & { _id: unknown }) {
  const pr = (u.practitioner as Obj) ?? {};
  return clean({ resourceType: 'Practitioner', id: String(u._id), meta: meta(cfg, 'Practitioner'), identifier: [pr.licenseNumber && { system: cfg.systems.practitionerLicense, value: pr.licenseNumber }, pr.registryId && { system: `${AFS}/health-worker-registry`, value: pr.registryId, type: { text: 'Health Worker Registry ID' } }].filter(Boolean), active: u.status === 'active', name: [{ text: u.name }], telecom: [u.phone && { system: 'phone', value: u.phone }, u.email && { system: 'email', value: u.email }].filter(Boolean), qualification: pr.cadre ? [{ code: { text: pr.cadre } }] : undefined });
}

export function toPractitionerRole(cfg: FhirConfig, u: Obj & { _id: unknown }, roleNames: string[], orgId: string, locationIds: string[]) {
  return clean({ resourceType: 'PractitionerRole', id: `${u._id}-role`, meta: meta(cfg, 'PractitionerRole'), active: u.status === 'active', practitioner: ref('Practitioner', u._id, u.name as string), organization: ref('Organization', orgId), code: roleNames.map((r) => ({ text: r })), location: locationIds.map((l) => ref('Location', l)) });
}

const ENCOUNTER_CLASS: Record<string, { code: string; display: string }> = { opd: { code: 'AMB', display: 'ambulatory' }, emergency: { code: 'EMER', display: 'emergency' }, inpatient: { code: 'IMP', display: 'inpatient encounter' }, maternity: { code: 'AMB', display: 'ambulatory' } };
export function toEncounter(cfg: FhirConfig, v: Obj & { _id: unknown }, extra: { providerId?: unknown; locationId?: unknown; diagnoses?: Array<{ conditionId: string; rank: number }> } = {}) {
  const status = v.status === 'closed' ? 'finished' : v.status === 'cancelled' ? 'cancelled' : v.status === 'open' ? 'arrived' : 'in-progress';
  const cls = ENCOUNTER_CLASS[v.type as string] ?? ENCOUNTER_CLASS.opd;
  return clean({
    resourceType: 'Encounter',
    id: String(v._id),
    meta: meta(cfg, 'Encounter', v.updatedAt as Date),
    identifier: [{ system: cfg.systems.visitNumber, value: v.visitNumber }],
    status,
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: cls.code, display: cls.display },
    type: [{ text: String(v.type).replace(/_/g, ' ') }],
    priority: v.priority === 'emergency' ? { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActPriority', code: 'EM' }] } : undefined,
    subject: ref('Patient', v.patientId),
    participant: extra.providerId ? [{ individual: ref('Practitioner', extra.providerId) }] : undefined,
    period: { start: dt(v.arrivedAt as Date ?? v.createdAt as Date), end: dt(v.closedAt as Date) },
    reasonCode: v.complaint ? [{ text: v.complaint }] : undefined,
    diagnosis: extra.diagnoses?.map((d) => ({ condition: ref('Condition', d.conditionId), rank: d.rank })),
    location: extra.locationId ? [{ location: ref('Location', extra.locationId) }] : undefined,
  });
}

export function toConditions(cfg: FhirConfig, c: Obj & { _id: unknown; diagnoses: Array<{ code?: string | null; display: string; system?: string | null; type?: string | null }> }) {
  return c.diagnoses.map((d, i) =>
    clean({
      resourceType: 'Condition',
      id: `${c._id}-dx-${i}`,
      meta: meta(cfg, 'Condition'),
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: d.type === 'provisional' ? 'provisional' : 'confirmed' }] },
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis' }] }],
      code: { coding: d.code ? [{ system: d.system === 'ICD-10' ? 'http://hl7.org/fhir/sid/icd-10' : 'http://id.who.int/icd/release/11/mms', code: d.code, display: d.display }] : undefined, text: d.display },
      subject: ref('Patient', c.patientId),
      encounter: ref('Encounter', c.visitId),
      recordedDate: dt(c.finalizedAt as Date ?? c.createdAt as Date),
      recorder: ref('Practitioner', c.providerId, c.providerName as string),
    }),
  );
}

/** Vital signs with standard LOINC codes (FHIR vital-signs category). */
const VITALS: Array<[string, string, string, string, string]> = [
  ['temperatureC', '8310-5', 'Body temperature', 'Cel', '°C'],
  ['pulse', '8867-4', 'Heart rate', '/min', 'beats/minute'],
  ['respiratoryRate', '9279-1', 'Respiratory rate', '/min', 'breaths/minute'],
  ['spo2', '59408-5', 'Oxygen saturation in Arterial blood by Pulse oximetry', '%', '%'],
  ['weightKg', '29463-7', 'Body weight', 'kg', 'kg'],
  ['heightCm', '8302-2', 'Body height', 'cm', 'cm'],
  ['bmi', '39156-5', 'Body mass index (BMI) [Ratio]', 'kg/m2', 'kg/m2'],
];
export function toObservations(cfg: FhirConfig, v: Obj & { _id: unknown }) {
  const base = (code: string, display: string) => ({ resourceType: 'Observation', meta: meta(cfg, 'Observation'), status: 'final', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }], code: { coding: [{ system: 'http://loinc.org', code, display }], text: display }, subject: ref('Patient', v.patientId), encounter: v.visitId ? ref('Encounter', v.visitId) : undefined, effectiveDateTime: dt(v.recordedAt as Date), performer: v.recordedBy ? [ref('Practitioner', v.recordedBy)] : undefined });
  const out: Obj[] = [];
  for (const [k, code, display, ucum, unit] of VITALS) if (v[k] != null) out.push(clean({ ...base(code, display), id: `${v._id}-${code}`, valueQuantity: { value: v[k], unit, system: 'http://unitsofmeasure.org', code: ucum } }));
  if (v.systolic != null || v.diastolic != null) {
    out.push(clean({ ...base('85354-9', 'Blood pressure panel'), id: `${v._id}-85354-9`, component: [v.systolic != null && { code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure' }] }, valueQuantity: { value: v.systolic, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } }, v.diastolic != null && { code: { coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic blood pressure' }] }, valueQuantity: { value: v.diastolic, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } }].filter(Boolean) }));
  }
  return out;
}

export function toLabObservations(cfg: FhirConfig, order: Obj & { _id: unknown; items: Array<Obj & { _id: unknown; results: Array<Obj> }> }) {
  return order.items.filter((i) => i.status === 'released').flatMap((i) =>
    i.results.map((r, k) =>
      clean({
        resourceType: 'Observation', id: `${i._id}-${k}`, meta: meta(cfg, 'Observation'), status: 'final',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
        code: { text: r.name ?? r.parameter }, subject: ref('Patient', order.patientId), encounter: order.visitId ? ref('Encounter', order.visitId) : undefined, basedOn: [ref('ServiceRequest', i._id)], issued: dt(i.releasedAt as Date),
        ...(typeof r.numeric === 'number' ? { valueQuantity: { value: r.numeric, unit: r.unit } } : { valueString: r.value }),
        interpretation: r.flag && r.flag !== '' ? [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: r.flag === 'A' ? 'A' : r.flag }] }] : undefined,
        referenceRange: r.referenceRange ? [{ text: r.referenceRange }] : undefined,
      }),
    ),
  );
}

export function toServiceRequests(cfg: FhirConfig, kind: 'lab' | 'imaging', o: Obj & { _id: unknown }) {
  const items = kind === 'lab' ? ((o.items as Array<Obj & { _id: unknown }>) ?? []) : [o];
  return items.map((i) =>
    clean({
      resourceType: 'ServiceRequest', id: String(i._id), meta: meta(cfg, 'ServiceRequest'),
      identifier: [{ system: `${AFS}/accession`, value: i.accessionNumber ?? o.accessionNumber }].filter((x) => x.value),
      status: ['cancelled'].includes(String(i.status)) ? 'revoked' : ['released', 'verified'].includes(String(i.status)) ? 'completed' : 'active',
      intent: 'order', priority: o.priority === 'stat' ? 'stat' : o.priority === 'urgent' ? 'urgent' : 'routine',
      category: [{ text: kind === 'lab' ? 'Laboratory procedure' : 'Imaging' }],
      code: { text: kind === 'lab' ? i.testName : o.examName },
      subject: ref('Patient', o.patientId), encounter: o.visitId ? ref('Encounter', o.visitId) : undefined,
      authoredOn: dt(o.createdAt as Date), requester: ref('Practitioner', o.orderedBy ?? o.requestedBy), reasonCode: o.clinicalNotes || o.clinicalIndication ? [{ text: o.clinicalNotes ?? o.clinicalIndication }] : undefined,
    }),
  );
}

export function toTask(cfg: FhirConfig, q: Obj & { _id: unknown }) {
  const status = ({ waiting: 'ready', called: 'ready', in_service: 'in-progress', done: 'completed', skipped: 'on-hold', cancelled: 'cancelled' } as Record<string, string>)[q.status as string] ?? 'requested';
  return clean({ resourceType: 'Task', id: String(q._id), meta: meta(cfg, 'Task'), status, intent: 'order', priority: q.priority === 'emergency' ? 'stat' : q.priority === 'urgent' ? 'urgent' : 'routine', code: { text: `Queue: ${q.stage}` }, for: ref('Patient', q.patientId), encounter: ref('Encounter', q.visitId), authoredOn: dt(q.createdAt as Date), lastModified: dt(q.updatedAt as Date), owner: q.servedBy ? ref('Practitioner', q.servedBy) : undefined });
}

export function toProcedure(cfg: FhirConfig, p: Obj & { _id: unknown }) {
  return clean({ resourceType: 'Procedure', id: String(p._id), meta: meta(cfg, 'Procedure'), status: p.status === 'done' ? 'completed' : p.status === 'cancelled' ? 'not-done' : 'preparation', code: { text: p.name }, subject: ref('Patient', p.patientId), encounter: p.visitId ? ref('Encounter', p.visitId) : undefined, performedDateTime: dt(p.performedAt as Date), performer: p.performedBy ? [{ actor: ref('Practitioner', p.performedBy) }] : undefined, note: p.notes ? [{ text: p.notes }] : undefined });
}

export function toDocumentReference(cfg: FhirConfig, d: Obj & { _id: unknown }, downloadUrl: string) {
  return clean({ resourceType: 'DocumentReference', id: String(d._id), meta: meta(cfg, 'DocumentReference'), status: d.deletedAt ? 'entered-in-error' : 'current', type: { text: String(d.category).replace(/_/g, ' ') }, subject: d.patientId ? ref('Patient', d.patientId) : undefined, date: dt(d.createdAt as Date), author: d.uploadedBy ? [ref('Practitioner', d.uploadedBy)] : undefined, description: d.title, content: [{ attachment: { contentType: d.mimeType, url: downloadUrl, size: d.sizeBytes, hash: undefined, title: d.fileName } }] });
}

export function toConsent(cfg: FhirConfig, p: Obj & { _id: unknown; consent?: { dataSharing?: boolean | null; capturedAt?: Date | null } | null }) {
  return clean({ resourceType: 'Consent', id: `${p._id}-hie`, meta: meta(cfg, 'Consent'), status: 'active', scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }] }, category: [{ text: 'Health information exchange' }], patient: ref('Patient', p._id), dateTime: dt(p.consent?.capturedAt), provision: { type: p.consent?.dataSharing ? 'permit' : 'deny' } });
}

export function toEpisodeOfCare(cfg: FhirConfig, preg: Obj & { _id: unknown }) {
  return clean({ resourceType: 'EpisodeOfCare', id: String(preg._id), meta: meta(cfg, 'EpisodeOfCare'), identifier: [{ system: `${AFS}/anc-number`, value: preg.ancNumber }], status: ['delivered', 'closed'].includes(String(preg.status)) ? 'finished' : 'active', type: [{ text: 'Antenatal care' }], patient: ref('Patient', preg.patientId), period: { start: dt(preg.createdAt as Date) } });
}

export function toProvenance(cfg: FhirConfig, targets: string[], agentId: unknown, recorded: Date, activity: string) {
  return clean({ resourceType: 'Provenance', id: `prov-${targets[0]?.replace('/', '-')}-${recorded.getTime()}`, meta: meta(cfg, 'Provenance'), target: targets.map((t) => ({ reference: t })), recorded: recorded.toISOString(), activity: { text: activity }, agent: [{ who: ref('Practitioner', agentId) }] });
}

/** Standard FHIR R4 Claim for SHA submission (verify against the eClaims IG profile before go-live). */
export function toClaim(cfg: FhirConfig, tx: Obj & { _id: unknown; lines: Array<Obj>; diagnoses: Array<Obj> }, orgId: string) {
  const use = tx.kind === 'preauthorization' ? 'preauthorization' : tx.kind === 'authorization' || tx.kind === 'visit_consent' ? 'predetermination' : 'claim';
  return clean({
    resourceType: 'Claim', id: String(tx._id), meta: meta(cfg, 'Claim'),
    identifier: [{ system: `${AFS}/sha-reference`, value: tx.reference }],
    status: 'active', type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: tx.accessPoint === 'IP' ? 'institutional' : 'professional' }] }, use,
    patient: ref('Patient', tx.patientId), created: dt(tx.createdAt as Date), provider: ref('Organization', orgId), priority: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/processpriority', code: 'normal' }] },
    insurance: [{ sequence: 1, focal: true, coverage: { display: 'SHA' } }],
    diagnosis: tx.diagnoses.map((d, i) => ({ sequence: i + 1, diagnosisCodeableConcept: { coding: d.code ? [{ code: d.code, display: d.display }] : undefined, text: d.display } })),
    supportingInfo: tx.clinicalJustification ? [{ sequence: 1, category: { text: 'clinical-justification' }, valueString: tx.clinicalJustification }] : undefined,
    item: tx.lines.map((l, i) => ({ sequence: i + 1, productOrService: { coding: [{ code: l.serviceCode }], text: l.description }, quantity: { value: l.quantity }, unitPrice: { value: l.unitPrice, currency: 'KES' }, net: { value: l.amount, currency: 'KES' } })),
    total: { value: (tx.amounts as Obj)?.claimed ?? 0, currency: 'KES' },
    encounter: tx.visitId ? [ref('Encounter', tx.visitId)] : undefined,
  });
}

/** ePrescription: one MedicationRequest per prescribed item. */
export function toMedicationRequests(cfg: FhirConfig, rx: Obj & { _id: unknown; items: Array<Obj & { _id: unknown }> }, extra: { itemCodes?: Record<string, string | undefined> } = {}) {
  return rx.items.filter((i) => i.status !== 'cancelled').map((i) => clean({
    resourceType: 'MedicationRequest', id: `${rx._id}-${i._id}`, meta: meta(cfg, 'MedicationRequest'),
    identifier: [{ system: `${AFS}/rx-number`, value: `${rx.rxNumber}/${String(i._id).slice(-6)}` }],
    status: rx.status === 'cancelled' ? 'cancelled' : 'active', intent: 'order',
    medicationCodeableConcept: { coding: extra.itemCodes?.[String(i.itemId)] ? [{ system: `${AFS}/item-code`, code: extra.itemCodes[String(i.itemId)] }] : undefined, text: i.drugName },
    subject: ref('Patient', rx.patientId), encounter: rx.visitId ? ref('Encounter', rx.visitId) : undefined,
    authoredOn: dt(rx.createdAt as Date), requester: rx.prescriberId ? ref('Practitioner', rx.prescriberId, rx.prescriberName as string) : undefined,
    dosageInstruction: [{ text: [i.dose, i.frequency, i.route, i.durationDays ? `for ${i.durationDays} days` : undefined, i.instructions].filter(Boolean).join(' '), route: i.route ? { text: i.route } : undefined }],
    dispenseRequest: { quantity: { value: i.quantity }, expectedSupplyDuration: i.durationDays ? { value: i.durationDays, unit: 'days', system: 'http://unitsofmeasure.org', code: 'd' } : undefined },
  }));
}

/** ePrescription dispense: one MedicationDispense per dispensed line. */
export function toMedicationDispenses(cfg: FhirConfig, rx: Obj & { _id: unknown; items: Array<Obj & { _id: unknown }>; dispenses: Array<Obj & { lines: Array<Obj> }> }) {
  const byItem = new Map(rx.items.map((i) => [String(i._id), i]));
  return rx.dispenses.flatMap((d, di) => d.lines.map((l, li) => {
    const item = byItem.get(String(l.rxItemId));
    return clean({
      resourceType: 'MedicationDispense', id: `${rx._id}-d${di}-${li}`, meta: meta(cfg, 'MedicationDispense'), status: 'completed',
      medicationCodeableConcept: { text: item?.drugName ?? 'Medication' }, subject: ref('Patient', rx.patientId),
      authorizingPrescription: [ref('MedicationRequest', `${rx._id}-${l.rxItemId}`)],
      quantity: { value: l.quantity }, whenHandedOver: dt(d.at as Date), performer: d.by ? [{ actor: ref('Practitioner', d.by, d.byName as string) }] : undefined,
      note: l.batchNumber ? [{ text: `Batch ${l.batchNumber}` }] : undefined,
    });
  }));
}

export function bundle(type: 'collection' | 'transaction' | 'searchset', resources: Obj[], cfg: FhirConfig) {
  return clean({
    resourceType: 'Bundle', type, timestamp: new Date().toISOString(), total: type === 'searchset' ? resources.length : undefined,
    entry: resources.map((r) => ({ fullUrl: `${cfg.base}/${r.resourceType}/${r.id}`, resource: r, ...(type === 'transaction' ? { request: { method: 'PUT', url: `${r.resourceType}/${r.id}` } } : {}) })),
  });
}
