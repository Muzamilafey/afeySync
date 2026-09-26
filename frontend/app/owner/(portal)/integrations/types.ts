import type { SettingField } from '@/features/integrations/SettingFields';
export interface OwnerIntegration {
  platformOnly?: boolean;
  provider: string;
  label: string;
  exists: boolean;
  enabled: boolean;
  environment: string;
  environments: string[];
  settings: Record<string, string>;
  settingFields: SettingField[];
  defaultBaseUrls?: Record<string, string>;
  secretFields: Array<{ key: string; label: string; required?: boolean; configured: boolean; hint?: string; updatedAt?: string }>;
  allowTenantCredentials: boolean;
  health: { status: string; lastTestAt?: string; lastSuccessAt?: string; lastFailureAt?: string; lastError?: string; lastLatencyMs?: number };
}
