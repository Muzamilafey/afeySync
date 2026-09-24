import type { Request } from 'express';

/** Placeholder hook replaced by the FHIR outbox implementation (see modules/fhir). */
export async function enqueueFhirForConsultation(_req: Request, _consultationId: string) {
  return null;
}
