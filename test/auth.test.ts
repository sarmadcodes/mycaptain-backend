import { describe, expect, it } from 'vitest';

import { api, auth, customer, passwordUser, uniquePhone } from './helpers';

describe('customer OTP auth', () => {
  it('signs up, returns a session and the profile', async () => {
    const c = await customer('Sana Qureshi');
    expect(c.user.role).toBe('customer');
    expect(c.user.passwordHash).toBeUndefined();
    const me = await api().get('/api/v1/auth/me').set(auth(c.token)).expect(200);
    expect(me.body.user.name).toBe('Sana Qureshi');
    expect(me.body.user.phone).toMatch(/^\+923\d{9}$/);
  });

  it('accepts local formats and normalises the phone number', async () => {
    const r = await api().post('/api/v1/auth/otp/request').send({ phone: '0300 765 4321', purpose: 'sign-up' }).expect(200);
    await api().post('/api/v1/auth/otp/verify').send({ phone: '+923007654321', code: r.body.devCode, name: 'Test' }).expect(201);
  });

  it('rejects sign-in for unknown numbers and sign-up for existing ones', async () => {
    await api().post('/api/v1/auth/otp/request').send({ phone: uniquePhone(), purpose: 'sign-in' }).expect(404);
    const c = await customer();
    await api().post('/api/v1/auth/otp/request').send({ phone: c.phone, purpose: 'sign-up' }).expect(409);
  });

  it('enforces resend cooldown', async () => {
    const phone = uniquePhone();
    await api().post('/api/v1/auth/otp/request').send({ phone, purpose: 'sign-up' }).expect(200);
    const r = await api().post('/api/v1/auth/otp/request').send({ phone, purpose: 'sign-up' }).expect(429);
    expect(r.headers['retry-after']).toBeDefined();
  });

  it('locks the code after too many wrong attempts', async () => {
    const phone = uniquePhone();
    const { body } = await api().post('/api/v1/auth/otp/request').send({ phone, purpose: 'sign-up' });
    for (let i = 0; i < 5; i++) {
      await api().post('/api/v1/auth/otp/verify').send({ phone, code: '000000', name: 'X Y' }).expect(400);
    }
    await api().post('/api/v1/auth/otp/verify').send({ phone, code: body.devCode, name: 'X Y' }).expect(429);
  });

  it('rejects invalid phone numbers with a clear message', async () => {
    const r = await api().post('/api/v1/auth/otp/request').send({ phone: '12345', purpose: 'sign-up' }).expect(400);
    expect(r.body.error.message).toMatch(/valid Pakistani mobile/);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and rejects reuse', async () => {
    const c = await customer();
    const r = await api().post('/api/v1/auth/refresh').send({ refreshToken: c.refresh }).expect(200);
    expect(r.body.refreshToken).not.toBe(c.refresh);
    await api().post('/api/v1/auth/refresh').send({ refreshToken: c.refresh }).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const c = await customer();
    await api().post('/api/v1/auth/logout').send({ refreshToken: c.refresh }).expect(204);
    await api().post('/api/v1/auth/refresh').send({ refreshToken: c.refresh }).expect(401);
  });

  it('rejects missing and forged access tokens', async () => {
    await api().get('/api/v1/auth/me').expect(401);
    await api().get('/api/v1/auth/me').set(auth('not.a.token')).expect(401);
  });

  it('password change signs out old access tokens', async () => {
    const a = await passwordUser('admin');
    await api().post('/api/v1/auth/password').set(auth(a.token)).send({ current: 'correct-horse-battery', next: 'new-password-456' }).expect(200);
    await api().get('/api/v1/auth/me').set(auth(a.token)).expect(401);
  });
});

describe('password login', () => {
  it('logs in admins and refuses wrong passwords with one generic message', async () => {
    const a = await passwordUser('admin');
    expect(a.user.role).toBe('admin');
    const bad = await api().post('/api/v1/auth/login').send({ identifier: a.phone, password: 'wrong' }).expect(401);
    const none = await api().post('/api/v1/auth/login').send({ identifier: uniquePhone(), password: 'wrong' }).expect(401);
    expect(bad.body.error.message).toBe(none.body.error.message);
  });

  it('customers cannot use password login', async () => {
    const c = await customer();
    await api().post('/api/v1/auth/login').send({ identifier: c.phone, password: 'anything' }).expect(401);
  });
});
