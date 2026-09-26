export type ReportType = 'sick_leave' | 'medical_report' | 'fitness' | 'attendance';
export interface MedicalReport {
  _id: string; reportNumber: string; type: ReportType; patientId: string; visitId?: string; status: 'draft' | 'final' | 'void';
  addressedTo?: string; subject?: string; body?: string; diagnosis?: string; includeDiagnosis?: boolean;
  restFrom?: string; restTo?: string; restDays?: number; fitness?: 'fit' | 'fit_with_restrictions' | 'unfit'; fitnessPurpose?: string; restrictions?: string; reviewDate?: string;
  authorId: string; authorName?: string; authorCadre?: string; authorLicence?: string; finalizedAt?: string; createdAt: string;
  voidReason?: string; voidedAt?: string; voidedByName?: string; addenda?: Array<{ text: string; byName?: string; at: string }>;
}

export const REPORT_TYPES: Record<ReportType, { label: string; title: string; hint: string }> = {
  sick_leave: { label: 'Sick leave note', title: 'SICK LEAVE CERTIFICATE', hint: 'Excuses the patient from work or school for a number of days.' },
  medical_report: { label: 'Medical report', title: 'MEDICAL REPORT', hint: 'A report on the patient’s condition for an employer, insurer, school, court or another doctor.' },
  fitness: { label: 'Fitness certificate', title: 'CERTIFICATE OF MEDICAL FITNESS', hint: 'Confirms the patient is fit (or not) for work, school, sport, travel or employment.' },
  attendance: { label: 'Attendance letter', title: 'CONFIRMATION OF ATTENDANCE', hint: 'Confirms the patient attended the facility on a date.' },
};

export const FITNESS_LABEL = { fit: 'FIT', fit_with_restrictions: 'FIT WITH RESTRICTIONS', unfit: 'NOT FIT' } as const;
