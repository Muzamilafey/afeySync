import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createFacility, OWNER_HOST, ownerToken, setupApp, teardown } from './helpers';
import { env } from '../src/config/env';
import { resolveMailConfig } from '../src/integrations/smtp/smtpService';

let owner: string;
let tenantId: string;
beforeAll(async () => {
  await setupApp();
  owner = await ownerToken();
  tenantId = (await createFacility(owner, 'mailfac')).id; // facility SMTP flag is off by default
});
afterAll(async () => {
  for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM', 'SMTP_ENCRYPTION'] as const) delete (env as Record<string, unknown>)[k];
  await teardown();
});

describe('which mail server is used', () => {
  it('explains what to configure when nothing is set up', async () => {
    await expect(resolveMailConfig(tenantId)).rejects.toMatchObject({ code: 'INTEGRATION_DISABLED', message: expect.stringMatching(/SMTP_HOST/) });
  });

  it('falls back to the SMTP_* environment variables when the owner never configured SMTP', async () => {
    Object.assign(env, { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USERNAME: 'afeysync@gmail.com', SMTP_PASSWORD: 'app-password', SMTP_FROM: 'AfeySync <afeysync@gmail.com>' });
    const cfg = await resolveMailConfig(tenantId); // facility without its own email still gets security emails
    expect(cfg).toMatchObject({ configId: 'env', settings: { host: 'smtp.gmail.com', port: '465', encryption: 'ssl', fromEmail: 'afeysync@gmail.com', fromName: 'AfeySync' }, secrets: { username: 'afeysync@gmail.com' } });
    Object.assign(env, { SMTP_FROM: 'noreply@afeysync.test', SMTP_PORT: '587' });
    expect((await resolveMailConfig(null)).settings).toMatchObject({ fromEmail: 'noreply@afeysync.test', encryption: 'starttls' });
  });

  it('prefers the SMTP configured in the owner portal', async () => {
    const r = await api().put('/api/v1/owner/integrations/smtp').set('Host', OWNER_HOST).set('Authorization', `Bearer ${owner}`)
      .send({ settings: { host: 'mail.afeysync.test', port: '587', fromEmail: 'hello@afeysync.test' }, secrets: { username: 'u', password: 'p' }, enabled: true });
    expect(r.status).toBe(200);
    const cfg = await resolveMailConfig(tenantId);
    expect(cfg.source).toBe('platform');
    expect(cfg.settings.host).toBe('mail.afeysync.test');
  });
});
