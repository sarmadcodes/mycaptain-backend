// Creates the default rate card and the first admin. Safe to run more than once.
import { env } from '@/config/env';
import { connectDb, disconnectDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { normalizePkMobile } from '@/lib/phone';
import { currentRates } from '@/models/rate-card';
import { UserModel } from '@/models/user';

async function main() {
  await connectDb();
  await currentRates();
  logger.info('rate card ready');

  const phone = env.SEED_ADMIN_PHONE ? normalizePkMobile(env.SEED_ADMIN_PHONE) : null;
  const password = env.SEED_ADMIN_PASSWORD;
  if (!phone || !password || password.length < 10) {
    logger.warn('Set SEED_ADMIN_PHONE and SEED_ADMIN_PASSWORD (10+ characters) to create the first admin.');
  } else if (await UserModel.exists({ phone })) {
    logger.info(`admin ${phone} already exists`);
  } else {
    const admin = new UserModel({ role: 'admin', name: 'Operations Admin', phone });
    await admin.setPassword(password);
    await admin.save();
    logger.info(`admin ${phone} created`);
  }
  await disconnectDb();
}

main().catch(async (err) => {
  logger.fatal({ err }, 'seed failed');
  await disconnectDb();
  process.exit(1);
});
