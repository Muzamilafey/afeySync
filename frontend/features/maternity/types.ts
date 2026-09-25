export interface BirthNotification {
  _id: string;
  notificationNumber: string;
  crsSerialNumber?: string;
  deliveryId: string;
  babyIndex: number;
  newbornPatientId?: string;
  child: { firstName: string; otherName?: string; fatherName?: string };
  sex: 'male' | 'female' | 'unknown';
  dateOfBirth: string;
  typeOfBirth: 'single' | 'twin' | 'triplet' | 'other';
  typeOfBirthOther?: string;
  natureOfBirth: 'born_alive' | 'born_dead';
  placeOfBirth: string;
  birthWeightGrams?: number;
  mother: { firstName: string; middleName?: string; lastName?: string; idNumber?: string };
  issuedTo: { relationship: 'mother' | 'father' | 'guardian' | 'other'; name?: string; idNumber?: string };
  issuedByName?: string;
  printCount: number;
  lastPrintedAt?: string;
  corrections?: Array<{ at: string; byName?: string; reason: string }>;
  createdAt: string;
}
