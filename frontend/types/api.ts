export interface Branch {
  _id: string;
  branchName: string;
  branchCode: string;
  isMain?: boolean;
  county?: string;
  subCounty?: string;
  ward?: string;
  facilityLevel?: string;
  facilityType?: string;
  facilityCode?: string;
  registrationNumber?: string;
  physicalAddress?: string;
  phone?: string;
  email?: string;
  status?: 'active' | 'suspended';
  bedCapacity?: number;
  staffCount?: number;
  services?: Record<string, boolean>;
}

export interface IntegrationFlag {
  enabled: boolean;
  /** Set up by the facility for its own account (M-Pesa Daraja, Pay Hero). */
  selfService?: boolean;
  message?: string;
  tenantCredentialsAllowed: boolean;
  usingFacilityConfig: boolean;
  health?: string;
}

export interface Me {
  user: { id: string; name: string; email: string; kind: 'tenant' | 'support'; roles: string[]; branchAccess: 'all' | 'specific'; mustChangePassword?: boolean };
  permissions: string[];
  tenant: { id: string; name: string; slug: string };
  activeBranch: { id: string; name: string; code: string } | null;
  branches: Branch[];
  integrations: Record<'sha' | 'dha' | 'mpesa' | 'africastalking' | 'smtp' | 'slade360', IntegrationFlag> & { payhero?: IntegrationFlag };
  subscription?: { plan: string; planName?: string; status: string; endsAt?: string; modules: string[]; unrestricted: boolean };
}

export interface Patient {
  _id: string;
  patientNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender: string;
  dateOfBirth?: string;
  phone?: string;
  email?: string;
  nationalId?: string;
  clientRegistryId?: string;
  shaNumber?: string;
  identifiers?: Array<{ type: string; value: string; source?: string }>;
  address?: Record<string, string>;
  nextOfKin?: Array<{ name: string; relationship: string; phone?: string; idNumber?: string }>;
  insurance?: Array<{ provider: string; scheme?: string; memberNumber: string }>;
  allergies?: Array<{ substance: string; reaction?: string; severity?: string }>;
  sha?: { status: 'unknown' | 'eligible' | 'not_eligible' | 'error'; lastCheckedAt?: string; isAlive?: boolean; whitelistedForOTP?: boolean; facilityBiometricsEnforced?: boolean; schemes?: Array<{ code?: string; name?: string; policyNumber?: string; principalCrId?: string }>; pomsf?: { code?: string; policyNumber?: string; principalCrId?: string } | null };
  dha?: { source: 'local' | 'client_registry'; importedAt?: string };
  consent?: { dataSharing?: boolean; sms?: boolean };
  registeredBranchName?: string;
  branches?: Array<{ _id: string; branchName: string }>;
  status?: string;
  createdAt?: string;
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
  county?: string;
  nationalId?: string;
  identifiers: Array<{ type: string; value: string }>;
  dependants: Array<{ name?: string; relationship?: string; clientRegistryId?: string }>;
  raw: Record<string, unknown>;
  existingPatient: null | { id?: string; patientNumber: string; name?: string; clientRegistryId?: string; accessible: boolean };
}

export const IDENTIFICATION_TYPES = ['National ID', 'ClientRegistry ID', 'Birth Notification', 'Birth Certificate', 'Alien ID', 'Refugee ID', 'Mandate Number'] as const;
