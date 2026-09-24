/**
 * Structural FHIR R4 validation performed before anything enters the outbox. This checks JSON structure,
 * resource types, required elements, identifiers, reference format, codes and date formats. It does NOT
 * replace validation against the Kenya Core / eClaims profiles with the official validator, and passing it
 * is never a claim of DHA certification.
 */
type Obj = Record<string, unknown>;
const REQUIRED: Record<string, string[]> = {
  Patient: ['identifier', 'name', 'gender'],
  Encounter: ['status', 'class', 'subject'],
  Condition: ['code', 'subject'],
  Observation: ['status', 'code', 'subject'],
  ServiceRequest: ['status', 'intent', 'code', 'subject'],
  Procedure: ['status', 'subject'],
  Organization: ['name'],
  Location: ['name'],
  Practitioner: ['name'],
  PractitionerRole: ['practitioner'],
  RelatedPerson: ['patient'],
  Task: ['status', 'intent'],
  DocumentReference: ['status', 'content'],
  Consent: ['status', 'scope', 'category'],
  EpisodeOfCare: ['status', 'patient'],
  Provenance: ['target', 'recorded', 'agent'],
  Claim: ['status', 'type', 'use', 'patient', 'created', 'provider', 'priority', 'insurance'],
  Bundle: ['type'],
};
const REF_RE = /^[A-Z][A-Za-z]+\/[A-Za-z0-9\-.]{1,64}$/;
const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function walk(node: unknown, path: string, errors: string[]) {
  if (Array.isArray(node)) {
    if (node.length === 0) errors.push(`${path}: empty arrays are not allowed in FHIR`);
    node.forEach((n, i) => walk(n, `${path}[${i}]`, errors));
    return;
  }
  if (node && typeof node === 'object') {
    const o = node as Obj;
    if (typeof o.reference === 'string' && !REF_RE.test(o.reference) && !/^https?:\/\//.test(o.reference)) errors.push(`${path}.reference: invalid reference "${o.reference}"`);
    for (const [k, v] of Object.entries(o)) {
      if (v === '' || v === null) errors.push(`${path}.${k}: empty value`);
      if (typeof v === 'string' && /(^|\.)(birthDate|date)$/.test(k) && !DATE_RE.test(v) && !DATETIME_RE.test(v)) errors.push(`${path}.${k}: invalid date`);
      if (typeof v === 'string' && /DateTime$|^(recorded|issued|authoredOn|created|lastModified)$/.test(k) && !DATETIME_RE.test(v)) errors.push(`${path}.${k}: invalid dateTime`);
      walk(v, `${path}.${k}`, errors);
    }
  }
}

export function validateResource(r: Obj): string[] {
  const errors: string[] = [];
  const type = r.resourceType as string;
  if (!type || !REQUIRED[type]) return [`Unsupported or missing resourceType: ${type}`];
  if (type !== 'Bundle' && (typeof r.id !== 'string' || !/^[A-Za-z0-9\-.]{1,64}$/.test(r.id))) errors.push(`${type}.id: invalid id`);
  for (const f of REQUIRED[type]) if (r[f] === undefined) errors.push(`${type}.${f}: required`);
  if (type === 'Patient') for (const id of (r.identifier as Obj[]) ?? []) if (!id.system || !id.value) errors.push('Patient.identifier: system and value required');
  if (type === 'Observation' && r.valueQuantity === undefined && r.valueString === undefined && r.component === undefined) errors.push('Observation: value[x] or component required');
  if ((type === 'Condition' || type === 'Observation' || type === 'ServiceRequest') && !(r.code as Obj)?.text && !((r.code as Obj)?.coding as Obj[])?.length) errors.push(`${type}.code: coding or text required`);
  walk(r, type, errors);
  if (type === 'Bundle') for (const e of (r.entry as Obj[]) ?? []) errors.push(...validateResource(e.resource as Obj).map((x) => `entry: ${x}`));
  return errors;
}
