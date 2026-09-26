'use client';

import { Field, Input, Select } from '@/components/ui';

export interface SettingField {
  key: string;
  label: string;
  required?: boolean;
  default?: string;
  options?: Array<{ value: string; label: string }>;
  help?: string;
  showWhen?: { key: string; value: string };
  hidden?: boolean;
}

/** The plain settings of an integration: drop-downs where the choice is fixed, and only the fields that apply. */
export function SettingFields({ fields, values, onChange }: { fields: SettingField[]; values: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  const set = (key: string, value: string) => onChange({ ...values, [key]: value });
  return (
    <>
      {fields
        .filter((f) => !f.hidden && (!f.showWhen || values[f.showWhen.key] === f.showWhen.value))
        .map((f, i) => (
          <Field key={`${f.key}-${i}`} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.help ?? (f.default ? `Default: ${f.default}` : undefined)} className={f.options ? 'sm:col-span-2' : undefined}>
            {f.options ? (
              <Select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">Choose…</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : (
              <Input value={values[f.key] ?? ''} inputMode={/till|shortcode|paybill/i.test(f.key) ? 'numeric' : undefined} autoComplete="off" onChange={(e) => set(f.key, e.target.value.trim() === '' ? '' : e.target.value)} />
            )}
          </Field>
        ))}
    </>
  );
}

type BaseUrls = Partial<Record<string, string>>;
const norm = (u?: string) => (u ?? '').replace(/\/+$/, '').toLowerCase();

/** Fills an empty base URL with the environment's official address so the box shows what will be used. */
export function prefillBaseUrl(settings: Record<string, string>, fields: SettingField[], defaults: BaseUrls | undefined, environment: string) {
  if (!fields.some((f) => f.key === 'baseUrl') || settings.baseUrl || !defaults?.[environment]) return settings;
  return { ...settings, baseUrl: defaults[environment]! };
}

/**
 * Switching environment moves the base URL to the new environment's address, unless someone typed their own
 * (a custom address is kept). With no official address for the new environment the box is cleared to be filled in.
 */
export function switchEnvironment(settings: Record<string, string>, fields: SettingField[], defaults: BaseUrls | undefined, to: string) {
  if (!fields.some((f) => f.key === 'baseUrl')) return settings;
  const current = norm(settings.baseUrl);
  const isDefault = !current || Object.values(defaults ?? {}).some((u) => norm(u) === current);
  if (!isDefault) return settings;
  return { ...settings, baseUrl: defaults?.[to] ?? '' };
}
