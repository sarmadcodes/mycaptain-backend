// Runs before every test file: test env, in-memory MongoDB, clean state between tests.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789-abcdefghijklmnop';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789-abcdefghijklmno';
process.env.OTP_PEPPER = 'test-otp-pepper-0123456789-abcdefghijklmnopqrstu';
process.env.REDIS_URL = '';
process.env.CLOUDINARY_CLOUD_NAME = 'test';
process.env.CLOUDINARY_API_KEY = 'test';
process.env.CLOUDINARY_API_SECRET = 'test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

// Never call Cloudinary from tests.
vi.mock('@/lib/cloudinary', () => ({
  uploadBuffer: vi.fn(async (_b: Buffer, o: { folder: string }) => ({
    url: `https://res.cloudinary.com/test/${o.folder}/file.png`,
    publicId: `my-captain/${o.folder}/file`,
    format: 'png',
    bytes: 100,
    resourceType: 'image',
  })),
  signedUrl: vi.fn(() => 'https://res.cloudinary.com/test/signed'),
  destroyFile: vi.fn(),
}));

let mongo: MongoMemoryServer;

beforeAll(async () => {
  // Tests write very little; skip mongod's 500 MB free-disk guard for index builds.
  mongo = await MongoMemoryServer.create({ instance: { args: ['--setParameter', 'indexBuildMinAvailableDiskSpaceMB=0'] } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

afterEach(async () => {
  const { kv, MemoryKv } = await import('@/lib/kv');
  if (kv instanceof MemoryKv) kv.clear();
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
