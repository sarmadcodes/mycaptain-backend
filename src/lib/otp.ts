import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { env, isProd } from '@/config/env';

import { AppError, tooMany } from './errors';
import { kv } from './kv';
import { sms } from './sms';

const CODE_TTL = 5 * 60;
const RESEND_COOLDOWN = 30;
const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

const digest = (phone: string, code: string) => createHmac('sha256', env.OTP_PEPPER).update(`${phone}:${code}`).digest();

export async function sendOtp(phone: string) {
  const cooldown = await kv.ttl(`otp:cd:${phone}`);
  if (cooldown > 0) throw tooMany(`Wait ${cooldown} seconds before requesting another code.`, cooldown);
  const sent = await kv.incr(`otp:hr:${phone}`, 3600);
  if (sent > MAX_PER_HOUR) throw tooMany('Too many codes requested. Try again in an hour.', 3600);

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await kv.set(`otp:${phone}`, digest(phone, code).toString('base64'), CODE_TTL);
  await kv.del(`otp:att:${phone}`);
  await kv.set(`otp:cd:${phone}`, '1', RESEND_COOLDOWN);
  await sms.send(phone, `${code} is your My Captain code. It expires in 5 minutes. Do not share it.`);

  // Development and tests get the code back to speed up testing; never in production.
  return { resendIn: RESEND_COOLDOWN, expiresIn: CODE_TTL, ...(isProd ? {} : { devCode: code }) };
}

export async function checkOtp(phone: string, code: string) {
  const stored = await kv.get(`otp:${phone}`);
  if (!stored) throw new AppError(400, 'otp_expired', 'This code has expired. Request a new one.');

  const attempts = await kv.incr(`otp:att:${phone}`, CODE_TTL);
  if (attempts > MAX_ATTEMPTS) {
    await kv.del(`otp:${phone}`);
    throw tooMany('Too many wrong attempts. Request a new code.');
  }

  const a = Buffer.from(stored, 'base64');
  const b = digest(phone, code);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError(400, 'otp_invalid', `That code is not correct. ${MAX_ATTEMPTS - attempts} attempts left.`);
  }
  await kv.del(`otp:${phone}`);
  await kv.del(`otp:att:${phone}`);
}
