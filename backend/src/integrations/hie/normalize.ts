/**
 * Defensive normalizers for HIE responses. The official response schemas live in the DHA HIE API
 * catalog; these helpers only pick well-known fields for display and always keep the untouched `raw`
 * payload, so nothing the registry returns is lost or reinterpreted. Field aliases must be reviewed
 * against the current documentation whenever the contract version changes.
 */
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export function pick(o: Obj | undefined, ...keys: string[]): string | undefined {
  if (!o) return undefined;
  for (const k of keys) {
    const v = k.split('.').reduce<unknown>((acc, part) => (isObj(acc) ? acc[part] : undefined), o);
    if (v !== undefined && v !== null && v !== '') return typeof v === 'object' ? undefined : String(v);
  }
  return undefined;
}

/** Unwrap `{ data: [...] }`, `{ result: ... }`, `{ patients: [...] }`, a bare array or a single object. */
export function unwrapList(body: unknown): Obj[] {
  if (Array.isArray(body)) return body.filter(isObj);
  if (!isObj(body)) return [];
  for (const key of ['data', 'result', 'results', 'patients', 'entry', 'items', 'message']) {
    const v = body[key];
    if (Array.isArray(v)) return v.map((e) => (isObj(e) && isObj(e.resource) ? (e.resource as Obj) : e)).filter(isObj);
    if (isObj(v)) return unwrapList(v).length ? unwrapList(v) : [v];
  }
  return [body];
}

export interface RegistryPatient {
  clientRegistryId?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  gender?: string;
  dateOfBirth?: string;
  phone?: string;
  email?: string;
  county?: string;
  subCounty?: string;
  ward?: string;
  nationalId?: string;
  shaNumber?: string;
  identifiers: Array<{ type: string; value: string }>;
  dependants: Array<{ name?: string; relationship?: string; clientRegistryId?: string; dateOfBirth?: string; gender?: string }>;
  raw: Obj;
}

function fhirName(o: Obj) {
  const name = Array.isArray(o.name) && isObj(o.name[0]) ? (o.name[0] as Obj) : undefined;
  if (!name) return {};
  const given = Array.isArray(name.given) ? (name.given as string[]) : [];
  return { firstName: given[0], middleName: given.slice(1).join(' ') || undefined, lastName: typeof name.family === 'string' ? name.family : undefined, fullName: typeof name.text === 'string' ? name.text : undefined };
}

export function normalizeRegistryPatient(o: Obj): RegistryPatient {
  const fhir = o.resourceType === 'Patient' ? fhirName(o) : {};
  const identifiers: Array<{ type: string; value: string }> = [];
  const rawIds = Array.isArray(o.identifiers) ? o.identifiers : Array.isArray(o.identifier) ? o.identifier : [];
  for (const id of rawIds) {
    if (!isObj(id)) continue;
    const type = pick(id, 'identification_type', 'type.text', 'type.coding.0.display', 'type', 'system') ?? 'Other';
    const value = pick(id, 'identification_number', 'value', 'number');
    if (value) identifiers.push({ type, value });
  }
  const telecom = Array.isArray(o.telecom) ? (o.telecom as Obj[]) : [];
  const address = Array.isArray(o.address) && isObj(o.address[0]) ? (o.address[0] as Obj) : isObj(o.address) ? (o.address as Obj) : undefined;
  const dependantsRaw = Array.isArray(o.dependants) ? o.dependants : Array.isArray(o.dependents) ? o.dependents : [];
  const firstName = fhir.firstName ?? pick(o, 'first_name', 'firstName', 'given_name');
  const lastName = fhir.lastName ?? pick(o, 'last_name', 'lastName', 'surname', 'family_name');
  const middleName = fhir.middleName ?? pick(o, 'middle_name', 'middleName', 'other_names');
  return {
    clientRegistryId: pick(o, 'client_registry_id', 'cr_id', 'crId', 'clientRegistryId', 'id'),
    firstName,
    middleName,
    lastName,
    fullName: fhir.fullName ?? pick(o, 'full_name', 'fullName', 'name') ?? ([firstName, middleName, lastName].filter(Boolean).join(' ') || undefined),
    gender: pick(o, 'gender', 'sex'),
    dateOfBirth: pick(o, 'date_of_birth', 'dateOfBirth', 'birthDate', 'dob'),
    phone: pick(o, 'phone', 'phone_number', 'phoneNumber', 'msisdn') ?? pick(telecom.find((t) => t.system === 'phone'), 'value'),
    email: pick(o, 'email') ?? pick(telecom.find((t) => t.system === 'email'), 'value'),
    county: pick(o, 'county', 'place_of_residence.county') ?? pick(address, 'county', 'district', 'state'),
    subCounty: pick(o, 'sub_county', 'subCounty') ?? pick(address, 'sub_county', 'subCounty'),
    ward: pick(o, 'ward') ?? pick(address, 'ward'),
    nationalId: pick(o, 'national_id', 'nationalId', 'id_number') ?? identifiers.find((i) => /national/i.test(i.type))?.value,
    shaNumber: pick(o, 'sha_number', 'shaNumber', 'member_number'),
    identifiers,
    dependants: dependantsRaw.filter(isObj).map((d) => ({
      name: pick(d, 'full_name', 'name') ?? [pick(d, 'first_name'), pick(d, 'last_name')].filter(Boolean).join(' '),
      relationship: pick(d, 'relationship'),
      clientRegistryId: pick(d, 'client_registry_id', 'cr_id', 'id'),
      dateOfBirth: pick(d, 'date_of_birth', 'dob'),
      gender: pick(d, 'gender'),
    })),
    raw: o,
  };
}

/** biometric_status.use_sil_biometrics from an eligibility response (snake or camel case), or null when absent. */
function silFlag(o: Record<string, unknown>): boolean | null {
  const bs = (o.biometric_status ?? o.biometricStatus) as Record<string, unknown> | undefined;
  const v = bs && typeof bs === 'object' ? (bs.use_sil_biometrics ?? bs.useSilBiometrics) : undefined;
  return typeof v === 'boolean' ? v : typeof v === 'string' ? v.toLowerCase() === 'true' : null;
}

export function normalizeEligibility(body: unknown) {
  const o = unwrapList(body)[0] ?? {};
  const statusText = pick(o, 'eligibility_status', 'status', 'eligibility', 'coverage_status');
  const flag = o.eligible ?? o.is_eligible ?? o.isEligible;
  let eligible: boolean | null = typeof flag === 'boolean' ? flag : null;
  if (eligible === null && statusText) {
    if (/not|inelig|inactive|suspend/i.test(statusText)) eligible = false;
    else if (/elig|active|covered|true/i.test(statusText)) eligible = true;
  }
  const bool = (...keys: string[]) => {
    for (const k of keys) if (typeof o[k] === 'boolean') return o[k] as boolean;
    return null;
  };
  // schemes may be an array of strings or objects; POMSF variants carry suffixes, so match by prefix.
  const schemesRaw = Array.isArray(o.schemes) ? (o.schemes as unknown[]) : [];
  const schemes = schemesRaw.map((sc) => {
    if (!isObj(sc)) return { code: String(sc), name: String(sc) };
    return { code: pick(sc, 'code', 'scheme_code', 'schemeCode', 'name'), name: pick(sc, 'name', 'scheme_name', 'schemeName', 'code'), policyNumber: pick(sc, 'policy_number', 'policyNumber'), principalCrId: pick(sc, 'principal_cr_id', 'principalCrId', 'principal_member_cr_id'), raw: sc };
  });
  const pomsf = schemes.find((sc) => /^POMSF/i.test(sc.code ?? '') || /^POMSF/i.test(sc.name ?? ''));
  const statusDesc = pick(o, 'statusDesc', 'status_desc');
  if (eligible === null && statusDesc) {
    if (/not|inelig|inactive|suspend/i.test(statusDesc)) eligible = false;
    else if (/elig|active|covered/i.test(statusDesc)) eligible = true;
  }
  return {
    eligible,
    statusText: statusText ?? statusDesc,
    statusCode: pick(o, 'statusCode', 'status_code'),
    memberName: pick(o, 'fullName', 'full_name', 'name', 'member_name', 'patient_name'),
    clientRegistryId: pick(o, 'memberCrNumber', 'member_cr_number', 'client_registry_id', 'cr_id', 'patient_id', 'id'),
    scheme: pick(o, 'scheme', 'scheme_name', 'coverage', 'payer') ?? schemes.map((sc) => sc.name).filter(Boolean).join(', '),
    schemes,
    pomsf: pomsf ? { code: pomsf.code, policyNumber: pomsf.policyNumber, principalCrId: pomsf.principalCrId } : null,
    isAlive: bool('isAlive', 'is_alive'),
    whitelistedForOTP: bool('whitelistedForOTP', 'whitelisted_for_otp'),
    facilityBiometricsEnforced: bool('facilityBiometricsEnforced', 'facility_biometrics_enforced'),
    // The payer decides the minors route; never derive it from the patient's age.
    useSilBiometrics: silFlag(o),
    age: pick(o, 'age'),
    dateOfBirth: pick(o, 'dateOfBirth', 'date_of_birth'),
    gender: pick(o, 'gender'),
    reason: pick(o, 'reason', 'message', 'remarks'),
    raw: o,
  };
}
