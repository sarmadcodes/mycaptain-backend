import mongoose from 'mongoose';

import { env } from '@/config/env';

import { logger } from './logger';

mongoose.set('strictQuery', true);

export async function connectDb(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  logger.info('mongodb connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
