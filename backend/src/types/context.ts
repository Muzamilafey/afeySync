import type { Types } from 'mongoose';
import type { TenantModels } from '../models/tenant';

export interface TenantContext {
  id: string;
  slug: string;
  name: string;
  dbName: string;
  status: string;
  models: TenantModels;
}

export interface TenantUserContext {
  kind: 'tenant' | 'support';
  id: string;
  name: string;
  email: string;
  permissions: Set<string>;
  roleKeys: string[];
  /** 'all' = tenant-wide access; otherwise restricted to `branchIds` */
  branchAccess: 'all' | 'specific';
  branchIds: string[];
  sessionId: string;
  supportGrantId?: string;
}

export interface PlatformUserContext {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: Set<string>;
  sessionId: string;
}

export interface BranchContext {
  id: string;
  name: string;
  code: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      /** Tenant resolved from the hostname / custom domain (never from client-supplied IDs) */
      hostTenantId?: string | null;
      isOwnerHost?: boolean;
      /** The central sign-in address (accounts.*). */
      isAccountsHost?: boolean;
      tenant?: TenantContext;
      user?: TenantUserContext;
      platformUser?: PlatformUserContext;
      branch?: BranchContext;
      permissions?: Set<string>;
    }
  }
}

export type ObjectIdLike = string | Types.ObjectId;
