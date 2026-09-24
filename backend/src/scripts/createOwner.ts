/**
 * Create the first Super Platform Owner.
 *   npm run seed:owner -- --email owner@afeysync.com --name "Platform Owner"
 * The password is read from AFS_OWNER_PASSWORD (never passed on the command line).
 */
import { connectMeta, disconnectAll } from '../db/connections';
import { ensureMetaIndexes, meta } from '../models/meta';
import { hashPassword, passwordPolicy } from '../modules/auth/password';
import { seedHieContracts } from '../integrations/hie/contractService';

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const email = arg('email');
  const name = arg('name') ?? 'Platform Owner';
  const password = process.env.AFS_OWNER_PASSWORD;
  if (!email || !password) {
    console.error('Usage: AFS_OWNER_PASSWORD=... npm run seed:owner -- --email you@example.com [--name "Name"]');
    process.exit(1);
  }
  const check = passwordPolicy.safeParse(password);
  if (!check.success) {
    console.error(check.error.issues[0].message);
    process.exit(1);
  }
  await connectMeta();
  await ensureMetaIndexes();
  await seedHieContracts();
  const { PlatformUser } = meta();
  if (await PlatformUser.exists({ email: email.toLowerCase() })) {
    console.log('User already exists; nothing to do.');
  } else {
    await PlatformUser.create({ email, name, role: 'super_owner', passwordHash: await hashPassword(password) });
    console.log(`Super Platform Owner ${email} created.`);
  }
  await disconnectAll();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
