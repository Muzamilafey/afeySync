import crypto from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError, badRequest, notFound } from '../../utils/errors';
import { randomToken, sha256 } from '../../utils/crypto';
import { enqueueSms } from '../notifications/notify';
import { audit } from '../audit/auditService';

/**
 * Admission phone verification: the admitting staff member sends a 6-digit code to the patient's
 * (or next of kin's) phone and enters it back. Emergency care is never blocked: when the patient
 * cannot receive or read a code, staff record a reason instead, and that choice is kept on the
 * admission and in the audit trail.
 */
export const POLICY_KEY = 'admissionPhoneVerification';
export type Policy = 'required' | 'optional' | 'off';
const CODE_TTL_MS = 10 * 60_000;
const TOKEN_TTL_MS = 30 * 60_000;
const RESEND_MS = 30_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;
const MAX_SENDS_PER_PATIENT_HOUR = 10;

export const SKIP_REASONS = {
  patient_unable: 'Patient unconscious or unable to respond (emergency)',
  no_phone: 'Patient has no phone',
  phone_unavailable: 'Phone not with the patient',
  no_network: 'No network / SMS not received',
  minor_no_guardian_phone: 'Minor, guardian phone not available',
  other: 'Other (explain)',
} as const;
export type SkipReason = keyof typeof SKIP_REASONS;

export async function admissionPolicy(req: Request): Promise<Policy> {
  const s = await req.tenant!.models.FacilitySetting.findOne({ key: POLICY_KEY }).lean();
  return s?.value === 'optional' || s?.value === 'off' ? s.value : 'required';
}

/** Kenyan mobiles (07…, 01…, +254…) become 2547…/2541…; other numbers need a country code. */
export function normalizePhone(raw: string) {
  const d = raw.replace(/[\s()-]/g, '');
  const digits = d.replace(/^\+/, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  if (/^\d{10,15}$/.test(digits) && (d.startsWith('+') || digits.startsWith('254'))) return digits;
  throw badRequest('Enter a valid mobile number, e.g. 0712345678 or +254712345678');
}
export const maskPhone = (p: string) => `${p.slice(0, 4)}${'*'.repeat(Math.max(0, p.length - 7))}${p.slice(-3)}`;

export const sendSchema = z.object({
  patientId: z.string(),
  target: z.enum(['patient', 'next_of_kin', 'other']).default('patient'),
  nextOfKinIndex: z.number().int().min(0).max(20).optional(),
  phone: z.string().trim().max(20).optional(),
  savePhone: z.boolean().optional(),
});

/** The phone numbers a code can go to, masked, for the admission form. */
export function phoneOptions(patient: { phone?: string | null; nextOfKin?: Array<{ name?: string | null; relationship?: string | null; phone?: string | null }> | null }) {
  const out: Array<{ target: 'patient' | 'next_of_kin'; index?: number; label: string; phoneMasked: string }> = [];
  const safe = (p?: string | null) => {
    try {
      return p ? normalizePhone(p) : null;
    } catch {
      return null;
    }
  };
  const own = safe(patient.phone);
  if (own) out.push({ target: 'patient', label: 'Patient', phoneMasked: maskPhone(own) });
  (patient.nextOfKin ?? []).forEach((k, i) => {
    const p = safe(k.phone);
    if (p) out.push({ target: 'next_of_kin', index: i, label: `${k.name ?? 'Next of kin'}${k.relationship ? ` (${k.relationship})` : ''}`, phoneMasked: maskPhone(p) });
  });
  return out;
}

export async function sendAdmissionCode(req: Request, patient: { _id: import('mongoose').Types.ObjectId; phone?: string | null; nextOfKin?: Array<{ phone?: string | null }> | null }, body: z.infer<typeof sendSchema>) {
  const { PatientPhoneOtp } = req.tenant!.models;
  let raw: string | null | undefined;
  if (body.target === 'patient') raw = patient.phone;
  else if (body.target === 'next_of_kin') raw = patient.nextOfKin?.[body.nextOfKinIndex ?? 0]?.phone;
  else raw = body.phone;
  if (!raw) throw badRequest(body.target === 'other' ? 'Enter the phone number to send the code to' : 'There is no phone number on record for this choice. Choose another number.');
  const phone = normalizePhone(raw);

  const hourAgo = new Date(Date.now() - 3_600_000);
  const recent = await PatientPhoneOtp.find({ patientId: patient._id, createdAt: { $gte: hourAgo } }).select('sends lastSentAt').lean();
  if (recent.reduce((n, r) => n + (r.sends ?? 1), 0) >= MAX_SENDS_PER_PATIENT_HOUR) throw new AppError(429, 'OTP_SEND_LIMIT', 'Too many codes sent for this patient. Try again later or record a reason to continue.');
  const last = recent.map((r) => r.lastSentAt?.getTime() ?? 0).sort().at(-1) ?? 0;
  if (Date.now() - last < RESEND_MS) throw new AppError(429, 'OTP_RESEND_TOO_SOON', `Wait ${Math.ceil((RESEND_MS - (Date.now() - last)) / 1000)} seconds before sending another code.`);

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const otp = new PatientPhoneOtp({ patientId: patient._id, phone, target: body.target, savePhone: body.target === 'other' && !!body.savePhone, codeHash: 'pending', expiresAt: new Date(Date.now() + CODE_TTL_MS), lastSentAt: new Date(), createdBy: req.user!.id });
  otp.codeHash = sha256(`${otp._id}:${code}`);
  await otp.save();
  // The code is only ever in the (encrypted) SMS job; it is never stored or logged in plain text.
  await enqueueSms(req.tenant!.id, `admission-otp:${otp._id}`, phone, `${req.tenant!.name}: your code to confirm admission is ${code}. Give it only to the admitting staff. It expires in 10 minutes.`, { sensitive: true, maxAttempts: 3 });
  await audit(req, { action: 'inpatient.admission_code_sent', resource: 'patient', resourceId: String(patient._id), newValue: { target: body.target, phone: maskPhone(phone) } });
  return { otpId: String(otp._id), sentTo: maskPhone(phone), expiresInSeconds: CODE_TTL_MS / 1000 };
}

export async function verifyAdmissionCode(req: Request, otpId: string, code: string) {
  const { PatientPhoneOtp } = req.tenant!.models;
  const otp = await PatientPhoneOtp.findById(otpId);
  if (!otp || otp.usedAt || String(otp.createdBy) !== req.user!.id) throw notFound('Code request not found. Send a new code.');
  if (otp.verifiedAt) throw new AppError(409, 'OTP_ALREADY_VERIFIED', 'This code was already used.');
  if (otp.expiresAt < new Date()) throw new AppError(400, 'OTP_EXPIRED', 'The code has expired. Send a new one.');
  if (otp.attempts >= MAX_ATTEMPTS) throw new AppError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many wrong codes. Send a new one.');
  const ok = /^\d{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(sha256(`${otp._id}:${code}`)), Buffer.from(otp.codeHash));
  if (!ok) {
    otp.attempts += 1;
    await otp.save();
    await audit(req, { action: 'inpatient.admission_code_failed', resource: 'patient', resourceId: String(otp.patientId), result: 'failure' });
    const left = MAX_ATTEMPTS - otp.attempts;
    throw new AppError(400, 'OTP_INVALID', left > 0 ? `That code is not correct. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Send a new one.');
  }
  const token = randomToken(24);
  otp.verifiedAt = new Date();
  otp.tokenHash = sha256(token);
  otp.tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await otp.save();
  await audit(req, { action: 'inpatient.admission_phone_verified', resource: 'patient', resourceId: String(otp.patientId), newValue: { phone: maskPhone(otp.phone), target: otp.target } });
  return { verificationToken: token, phoneMasked: maskPhone(otp.phone) };
}

export const verificationInput = z.union([
  z.object({ token: z.string().min(20).max(100) }),
  z.object({ skipReason: z.enum(Object.keys(SKIP_REASONS) as [SkipReason, ...SkipReason[]]), note: z.string().trim().max(300).optional() }),
]);

/**
 * Checks the verification sent with an admission and returns what to store on it. A token is used
 * once, only for the same patient and by the same staff member who verified it.
 */
export async function consumeVerification(req: Request, patientId: string, input: z.infer<typeof verificationInput> | undefined) {
  const policy = await admissionPolicy(req);
  const by = { by: req.user!.id, byName: req.user!.name };
  if (!input) {
    if (policy === 'required') throw new AppError(400, 'PHONE_VERIFICATION_REQUIRED', "Confirm the patient's phone with a code, or record why it cannot be done.");
    return { status: 'not_required' as const, ...by };
  }
  if ('skipReason' in input) {
    if (input.skipReason === 'other' && (input.note ?? '').length < 5) throw badRequest('Explain why the phone could not be verified');
    return { status: 'skipped' as const, skipReason: SKIP_REASONS[input.skipReason], skipNote: input.note || undefined, ...by };
  }
  const { PatientPhoneOtp, Patient } = req.tenant!.models;
  const otp = await PatientPhoneOtp.findOneAndUpdate(
    { tokenHash: sha256(input.token), usedAt: null, patientId, createdBy: req.user!.id, tokenExpiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!otp) throw new AppError(400, 'PHONE_VERIFICATION_INVALID', 'The phone verification has expired or does not match this patient. Send a new code.');
  if (otp.savePhone) {
    const before = await Patient.findById(patientId).select('phone').lean();
    await Patient.updateOne({ _id: patientId }, { $set: { phone: otp.phone } });
    await audit(req, { action: 'patient.phone_updated_verified', resource: 'patient', resourceId: patientId, oldValue: { phone: before?.phone }, newValue: { phone: otp.phone, source: 'admission_verification' } });
  }
  return { status: 'verified' as const, method: 'sms_code', target: otp.target, phoneMasked: maskPhone(otp.phone), verifiedAt: otp.verifiedAt ?? new Date(), ...by };
}
