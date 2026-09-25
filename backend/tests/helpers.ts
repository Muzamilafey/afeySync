import request from 'supertest';
import type { Express } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { connectMeta, disconnectAll, getMetaConn } from '../src/db/connections';
import { ensureMetaIndexes, meta } from '../src/models/meta';
import { seedHieContracts } from '../src/integrations/hie/contractService';
import { createApp } from '../src/app';
import { hashPassword } from '../src/modules/auth/password';
import { getTenantBaseConn } from '../src/db/connections';
import { env } from '../src/config/env';
import { clearTokenCache } from '../src/integrations/hie/hieClient';

export const OWNER_HOST = 'owner.afeysync.test';
export const PASSWORD = 'Str0ngPassw0rd!';
let app: Express;

export async function setupApp() {
  await connectMeta();
  await ensureMetaIndexes();
  await seedHieContracts();
  app = createApp();
  return app;
}

export async function teardown() {
  clearTokenCache();
  const base = getTenantBaseConn();
  const dbs = await base.db!.admin().listDatabases({ nameOnly: true });
  for (const d of dbs.databases) if (d.name.startsWith(env.TENANT_DB_PREFIX)) await base.useDb(d.name).dropDatabase();
  await getMetaConn().dropDatabase();
  await disconnectAll();
}

export const api = () => request(app);

export async function ownerToken(email = 'owner@afeysync.test') {
  const { PlatformUser } = meta();
  if (!(await PlatformUser.exists({ email }))) await PlatformUser.create({ email, name: 'Owner', role: 'super_owner', passwordHash: await hashPassword(PASSWORD) });
  const res = await api().post('/api/v1/owner/auth/login').set('Host', OWNER_HOST).send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`owner login failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken as string;
}

export async function createFacility(owner: string, slug: string, branches = [{ branchName: 'Main Branch', branchCode: 'MAIN' }]) {
  const res = await api()
    .post('/api/v1/owner/tenants')
    .set('Host', OWNER_HOST)
    .set('Authorization', `Bearer ${owner}`)
    .send({
      facility: { name: `${slug} Hospital`, slug, county: 'Mandera' },
      administrator: { name: `${slug} Admin`, email: `admin@${slug}.test`, password: PASSWORD },
      branches,
      integrations: { sha: true, dha: true },
      subscription: { plan: 'standard', maxBranches: 10, maxUsers: 50 },
    });
  if (res.status !== 201) throw new Error(`create facility failed ${res.status} ${JSON.stringify(res.body)}`);
  await completeFirstLogin(slug, `admin@${slug}.test`);
  return res.body.data as { id: string; slug: string; branches: Array<{ id: string; branchCode: string }>; admin: { email: string } };
}

/**
 * New accounts must choose their own password before anything else (enforced by the API). Changes it and
 * back to PASSWORD, as a real user would on first sign-in, so tests can keep signing in with PASSWORD.
 */
export async function completeFirstLogin(slug: string, email: string) {
  const first = (await tenantLogin(slug, email)).token;
  const a = await t(slug, first).post('/api/v1/auth/change-password').send({ currentPassword: PASSWORD, newPassword: `${PASSWORD}x` });
  if (a.status !== 200) throw new Error(`first password change failed ${a.status} ${JSON.stringify(a.body)}`);
  const second = (await tenantLogin(slug, email, `${PASSWORD}x`)).token;
  await t(slug, second).post('/api/v1/auth/change-password').send({ currentPassword: `${PASSWORD}x`, newPassword: PASSWORD });
}

export const hostOf = (slug: string) => `${slug}.afeysync.test`;

export async function tenantLogin(slug: string, email: string, password = PASSWORD) {
  const res = await api().post('/api/v1/auth/login').set('Host', hostOf(slug)).send({ email, password });
  if (res.status !== 200) throw new Error(`tenant login failed ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.data.accessToken as string, cookies: res.headers['set-cookie'] as unknown as string[] };
}

/** Tenant request helper: host + bearer + optional branch. */
export function t(slug: string, token: string, branchId?: string) {
  const wrap = (r: request.Test) => {
    r.set('Host', hostOf(slug)).set('Authorization', `Bearer ${token}`);
    if (branchId) r.set('X-Branch-Id', branchId);
    return r;
  };
  return {
    get: (url: string) => wrap(api().get(url)),
    post: (url: string) => wrap(api().post(url)),
    patch: (url: string) => wrap(api().patch(url)),
    put: (url: string) => wrap(api().put(url)),
    del: (url: string) => wrap(api().delete(url)),
  };
}

export async function createUser(slug: string, adminToken: string, opts: { email: string; roleKey: string; branchAccess: 'all' | 'specific'; branchIds: string[] }) {
  const roles = await t(slug, adminToken).get('/api/v1/roles');
  const role = roles.body.data.find((r: { key: string }) => r.key === opts.roleKey);
  const res = await t(slug, adminToken).post('/api/v1/users').send({ name: opts.email.split('@')[0], email: opts.email, roleIds: [role._id], branchAccess: opts.branchAccess, branchIds: opts.branchIds, password: PASSWORD });
  if (res.status !== 201) throw new Error(`create user failed ${res.status} ${JSON.stringify(res.body)}`);
  await completeFirstLogin(slug, opts.email);
  return (await tenantLogin(slug, opts.email)).token;
}

/* ------------------------------------------------------------------ DHA HIE test double
   A local HTTP stub used ONLY in automated tests to exercise the adapter (token caching, retries,
   headers, error mapping). It is not shipped and is never used at runtime. */
export interface StubState {
  tokenCalls: number;
  calls: Array<{ method: string; path: string; query: Record<string, string>; headers: http.IncomingHttpHeaders }>;
  failNext: number;
  expireTokenOnce: boolean;
}

export async function startHieStub() {
  const state: StubState = { tokenCalls: 0, calls: [], failNext: 0, expireTokenOnce: false };
  let currentToken = 'tok-1';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const query = Object.fromEntries(url.searchParams.entries());
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (url.pathname === '/api/v1/tenants/token' && req.method === 'POST') {
        state.tokenCalls += 1;
        const form = new URLSearchParams(body);
        if (form.get('client_secret') !== 'good-secret') return json(401, { error: 'invalid_client' });
        currentToken = `tok-${state.tokenCalls}`;
        return json(200, { access_token: currentToken, expires_in: 3600, token_type: 'Bearer' });
      }
      state.calls.push({ method: req.method!, path: url.pathname, query, headers: req.headers });
      if (req.headers.authorization !== `Bearer ${currentToken}`) return json(401, { message: 'expired' });
      if (state.expireTokenOnce) {
        state.expireTokenOnce = false;
        return json(401, { message: 'expired' });
      }
      if (state.failNext > 0) {
        state.failNext -= 1;
        return json(503, { message: 'busy' });
      }
      if (url.pathname === '/api/v1/patients') {
        if (query.identification_number === '12345678') {
          return json(200, {
            data: [{ client_registry_id: 'CR1234567890', first_name: 'JOHN', middle_name: 'ALI', last_name: 'DOE', gender: 'male', date_of_birth: '1990-01-12', phone: '0712345678', county: 'Mandera', identifiers: [{ identification_type: 'National ID', identification_number: '12345678' }] }],
          });
        }
        return json(404, { message: 'Patient not found' });
      }
      if (url.pathname === '/api/v1/patients/eligibility') {
        return json(200, { data: { eligible: query.identification_number !== '99999999', full_name: 'JOHN ALI DOE', client_registry_id: 'CR1234567890', scheme: 'SHA' } });
      }
      if (url.pathname === '/api/v1/patients/benefits') return json(200, { data: [{ code: 'OP', name: 'Outpatient' }], pagination: { page: 1, total: 1 } });
      if (url.pathname === '/api/v1/patients/benefits/utilization') return json(200, { data: { individual_limit: 1000, individual_used: 200 } });
      // Paths under /__test__/ exist only in this stub. Tests point a contract operation at them to exercise
      // AfeySync's submission plumbing; they are not SHA endpoints.
      if (url.pathname.startsWith('/api/v1/__test__/')) {
        if (query.fail === '1' || body.includes('"FORCE_REJECT"')) return json(422, { message: 'Validation failed at SHA' });
        const ext = `EXT-${state.calls.length}`;
        return json(201, { claim_id: ext, id: ext });
      }
      return json(404, { message: 'no route' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return { state, baseUrl: `http://127.0.0.1:${port}/api/v1`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export async function configureHie(owner: string, baseUrl: string, secret = 'good-secret') {
  for (const provider of ['dha', 'sha']) {
    const res = await api()
      .put(`/api/v1/owner/integrations/${provider}`)
      .set('Host', OWNER_HOST)
      .set('Authorization', `Bearer ${owner}`)
      .send({ environment: 'uat', settings: { baseUrl, facilityRegistryCode: 'FID-47-123456-1', facilityIdType: 'fr-code' }, secrets: { clientId: 'client-1', clientSecret: secret }, enabled: true });
    if (res.status !== 200) throw new Error(`configure ${provider} failed ${JSON.stringify(res.body)}`);
  }
  clearTokenCache();
}
