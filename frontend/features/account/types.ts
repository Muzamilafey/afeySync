export interface MyProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  roles: Array<{ name: string; key: string }>;
  branchAccess: 'all' | 'specific';
  branches: Array<{ name: string; code: string }>;
  defaultBranch: string | null;
  practitioner: { cadre: string | null; licenseNumber: string | null; registryVerified: boolean };
  facility: string;
  memberSince: string | null;
  lastLoginAt: string | null;
  security: { passwordChangedAt: string | null; twoStep: string[]; googleLinked: boolean };
}
export interface MySession { id: string; current: boolean; device: string; ip: string | null; signedInAt: string; lastActiveAt: string | null; method: string }
export interface MyActivity { at: string; event: string; ok: boolean; ip: string | null; device: string }
