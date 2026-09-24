import crypto from 'node:crypto';

const run = crypto.randomBytes(3).toString('hex');
process.env.NODE_ENV = 'test';
process.env.MONGO_META_URI = process.env.TEST_MONGO_URI ? `${process.env.TEST_MONGO_URI.replace(/\/$/, '')}/afstest_${run}_meta` : `mongodb://127.0.0.1:27017/afstest_${run}_meta`;
process.env.TENANT_DB_PREFIX = `afstest_${run}_t_`;
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = crypto.randomBytes(32).toString('hex');
process.env.INTEGRATION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.PLATFORM_DOMAIN = 'afeysync.test';
process.env.OWNER_HOSTS = 'owner.afeysync.test';
process.env.API_URL = 'https://api.afeysync.test';
process.env.BCRYPT_ROUNDS = '4';
process.env.RUN_WORKERS = 'false';
