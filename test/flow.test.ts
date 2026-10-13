import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import { attachRealtime, closeRealtime } from '@/lib/realtime';

import { api, app, application, auth, customer, inTwoHours, passwordUser, PNG } from './helpers';

const v1 = '/api/v1';

// Approved partner with one driver, two guards and one gunman.
async function approvedPartner() {
  const admin = await passwordUser('admin');
  const applied = await api().post(`${v1}/companies/applications`).send(application()).expect(201);
  const partnerToken = applied.body.accessToken as string;
  const companyId = applied.body.company.id as string;

  // Approval needs the documents.
  const early = await api().post(`${v1}/companies/${companyId}/review`).set(auth(admin.token)).send({ decision: 'approve' }).expect(400);
  expect(early.body.error.details.missing).toContain('registration');

  for (const kind of ['registration', 'ntn', 'security_licence']) {
    await api().post(`${v1}/companies/me/documents`).set(auth(partnerToken)).field('kind', kind).attach('file', PNG, 'doc.png').expect(201);
  }
  const approved = await api().post(`${v1}/companies/${companyId}/review`).set(auth(admin.token)).send({ decision: 'approve' }).expect(200);
  expect(approved.body.company.status).toBe('approved');

  const mk = async (staffKind: string, phone: string) =>
    (
      await api()
        .post(`${v1}/companies/me/staff`)
        .set(auth(partnerToken))
        .send({ name: `${staffKind} ${phone.slice(-3)}`, phone, staffKind, password: 'staff-password-1' })
        .expect(201)
    ).body.staff;
  const driver = await mk('driver', '3451110001');
  const guard1 = await mk('guard', '3451110002');
  const guard2 = await mk('guard', '3451110003');
  const gunman = await mk('gunman', '3451110004');

  const login = async (phone: string) =>
    (await api().post(`${v1}/auth/login`).send({ identifier: phone, password: 'staff-password-1' }).expect(200)).body.accessToken as string;

  return { admin, partnerToken, companyId, driver, guard1, guard2, gunman, driverToken: await login('3451110001'), login };
}

describe('partner onboarding', () => {
  it('rejects documents with a fake file type', async () => {
    const applied = await api().post(`${v1}/companies/applications`).send(application()).expect(201);
    await api()
      .post(`${v1}/companies/me/documents`)
      .set(auth(applied.body.accessToken))
      .field('kind', 'ntn')
      .attach('file', Buffer.from('not really a png'), { filename: 'x.png', contentType: 'image/png' })
      .expect(400);
  });

  it('security companies must send a licence', async () => {
    const r = await api()
      .post(`${v1}/companies/applications`)
      .send(application({ securityLicence: undefined }))
      .expect(400);
    expect(r.body.error.message).toMatch(/licence/);
  });

  it('staff cannot sign in until the company is approved', async () => {
    const p = await approvedPartner();
    await api().post(`${v1}/companies/${p.companyId}/review`).set(auth(p.admin.token)).send({ decision: 'suspend', note: 'Licence review' }).expect(200);
    await api().get(`${v1}/auth/me`).set(auth(p.driverToken)).expect(401);
    await api().post(`${v1}/auth/login`).send({ identifier: '3451110001', password: 'staff-password-1' }).expect(403);
  });

  it('partners cannot add staff before approval', async () => {
    const applied = await api().post(`${v1}/companies/applications`).send(application()).expect(201);
    await api()
      .post(`${v1}/companies/me/staff`)
      .set(auth(applied.body.accessToken))
      .send({ name: 'Early Bird', phone: '3459990000', staffKind: 'driver', password: 'staff-password-1' })
      .expect(403);
  });
});

describe('booking lifecycle', () => {
  it('runs from request to closed with role checks at each step', async () => {
    const p = await approvedPartner();
    const c = await customer();

    const input = {
      service: 'driver',
      plan: 'hourly',
      hours: 4,
      asap: true,
      vehicle: { class: 'suv', transmission: 'automatic', makeModel: 'Toyota Fortuner' },
      location: { address: 'DHA Phase 6, Karachi' },
      // Clients cannot set the price; unknown fields are stripped.
      price: { total: 1 },
    };
    const quote = await api().post(`${v1}/bookings/quote`).set(auth(c.token)).send(input).expect(200);
    expect(quote.body.price.total).toBe(4200); // 1000 x 4 + 5% fee

    const created = await api().post(`${v1}/bookings`).set(auth(c.token)).send(input).expect(201);
    const b = created.body.booking;
    expect(b.code).toMatch(/^MC-\d+$/);
    expect(b.status).toBe('pending_payment');
    expect(b.price.total).toBe(4200);

    // Customers cannot mark their own booking paid.
    await api().post(`${v1}/bookings/${b.id}/status`).set(auth(c.token)).send({ to: 'paid' }).expect(409);
    const paid = await api().post(`${v1}/bookings/${b.id}/status`).set(auth(p.admin.token)).send({ to: 'paid' }).expect(200);
    expect(paid.body.booking.status).toBe('assigning');

    // Partner cannot see it until assigned.
    await api().get(`${v1}/bookings/${b.id}`).set(auth(p.partnerToken)).expect(404);
    await api().post(`${v1}/bookings/${b.id}/assign-company`).set(auth(p.admin.token)).send({ companyId: p.companyId }).expect(200);

    // Wrong staff type is refused, then the driver is assigned.
    await api().post(`${v1}/bookings/${b.id}/assign-staff`).set(auth(p.partnerToken)).send({ staffIds: [p.guard1.id] }).expect(400);
    const confirmed = await api().post(`${v1}/bookings/${b.id}/assign-staff`).set(auth(p.partnerToken)).send({ staffIds: [p.driver.id] }).expect(200);
    expect(confirmed.body.booking.status).toBe('confirmed');
    expect(confirmed.body.booking.staff[0].name).toBeDefined();
    expect(confirmed.body.booking.staff[0].phone).toBeUndefined();

    // Driver sees it and runs the duty; skipping a step is refused.
    const list = await api().get(`${v1}/bookings`).set(auth(p.driverToken)).expect(200);
    expect(list.body.items).toHaveLength(1);
    await api().post(`${v1}/bookings/${b.id}/status`).set(auth(p.driverToken)).send({ to: 'completed' }).expect(409);
    for (const to of ['arriving', 'on_duty', 'completed']) {
      await api().post(`${v1}/bookings/${b.id}/status`).set(auth(p.driverToken)).send({ to }).expect(200);
    }
    const closed = await api().post(`${v1}/bookings/${b.id}/status`).set(auth(c.token)).send({ to: 'closed' }).expect(200);
    expect(closed.body.booking.status).toBe('closed');
    expect(closed.body.booking.history.map((h: { status: string }) => h.status)).toEqual([
      'pending_payment',
      'paid',
      'assigning',
      'assigning',
      'confirmed',
      'arriving',
      'on_duty',
      'completed',
      'closed',
    ]);
  });

  it('security team needs one armed lead plus the chosen guards', async () => {
    const p = await approvedPartner();
    const c = await customer();
    const created = await api()
      .post(`${v1}/bookings`)
      .set(auth(c.token))
      .send({ service: 'team', plan: 'hourly', hours: 8, startAt: inTwoHours(), personnel: 2, location: { address: 'Warehouse, SITE Area' } })
      .expect(201);
    const id = created.body.booking.id;
    expect(created.body.booking.price.total).toBe(Math.round((1200 + 700 * 2) * 8 * 1.05));
    await api().post(`${v1}/bookings/${id}/status`).set(auth(p.admin.token)).send({ to: 'paid' }).expect(200);
    await api().post(`${v1}/bookings/${id}/assign-company`).set(auth(p.admin.token)).send({ companyId: p.companyId }).expect(200);
    await api().post(`${v1}/bookings/${id}/assign-staff`).set(auth(p.partnerToken)).send({ staffIds: [p.guard1.id, p.guard2.id] }).expect(400);
    await api()
      .post(`${v1}/bookings/${id}/assign-staff`)
      .set(auth(p.partnerToken))
      .send({ staffIds: [p.gunman.id, p.guard1.id, p.guard2.id] })
      .expect(200);
  });

  it('rental bookings use the car day rate and minimum hours', async () => {
    const p = await approvedPartner();
    const c = await customer();
    const car = await api()
      .post(`${v1}/companies/me/cars`)
      .set(auth(p.partnerToken))
      .send({ name: 'Toyota Prado', class: 'suv', seats: 7, transmission: 'automatic', perDay: 26000 })
      .expect(201);
    const cars = await api().get(`${v1}/cars`).expect(200);
    expect(cars.body.cars[0].companyName).toBeDefined();

    const base = { service: 'rental', plan: 'hourly', asap: true, carId: car.body.car.id, location: { address: 'Bahria Town' } };
    await api().post(`${v1}/bookings`).set(auth(c.token)).send({ ...base, hours: 2 }).expect(400);
    const ok = await api().post(`${v1}/bookings`).set(auth(c.token)).send({ ...base, hours: 4 }).expect(201);
    expect(ok.body.booking.price.total).toBe(13650);
  });

  it('customers only see their own bookings', async () => {
    const a = await customer('A Customer');
    const b = await customer('B Customer');
    const created = await api()
      .post(`${v1}/bookings`)
      .set(auth(a.token))
      .send({ service: 'gunman', plan: 'daily', days: 1, startAt: inTwoHours(), location: { address: 'Clifton Block 5' } })
      .expect(201);
    await api().get(`${v1}/bookings/${created.body.booking.id}`).set(auth(b.token)).expect(404);
    const list = await api().get(`${v1}/bookings`).set(auth(b.token)).expect(200);
    expect(list.body.items).toHaveLength(0);
  });

  it('refuses short notice and cancels with a reason', async () => {
    const c = await customer();
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    const body = { service: 'guard', plan: 'hourly', hours: 4, startAt: soon, location: { address: 'Main Gate, Clifton' } };
    await api().post(`${v1}/bookings`).set(auth(c.token)).send(body).expect(400);
    const created = await api().post(`${v1}/bookings`).set(auth(c.token)).send({ ...body, startAt: inTwoHours() }).expect(201);
    await api().post(`${v1}/bookings/${created.body.booking.id}/status`).set(auth(c.token)).send({ to: 'cancelled' }).expect(400);
    const r = await api()
      .post(`${v1}/bookings/${created.body.booking.id}/status`)
      .set(auth(c.token))
      .send({ to: 'cancelled', note: 'Plans changed' })
      .expect(200);
    expect(r.body.booking.status).toBe('cancelled');
  });
});

describe('rate card', () => {
  it('admins update rates and new quotes use them', async () => {
    const admin = await passwordUser('admin');
    const c = await customer();
    const { body } = await api().get(`${v1}/rates`).expect(200);
    await api()
      .put(`${v1}/rates`)
      .set(auth(admin.token))
      .send({ ...body.rates, guardHourly: 1000 })
      .expect(200);
    await api().put(`${v1}/rates`).set(auth(c.token)).send(body.rates).expect(403);
    const q = await api()
      .post(`${v1}/bookings/quote`)
      .set(auth(c.token))
      .send({ service: 'guard', plan: 'hourly', hours: 2, asap: true, location: { address: 'Zamzama' } })
      .expect(200);
    expect(q.body.price.subtotal).toBe(2000);
  });
});

describe('live updates', () => {
  let server: Server | undefined;
  const sockets: Socket[] = [];

  afterEach(async () => {
    sockets.forEach((s) => s.disconnect());
    await closeRealtime();
    await new Promise((r) => (server ? server.close(r) : r(undefined)));
  });

  it('pushes booking changes to the customer and refuses bad tokens', async () => {
    server = createServer(app);
    attachRealtime(server);
    await new Promise<void>((r) => server!.listen(0, r));
    const url = `http://localhost:${(server.address() as AddressInfo).port}`;

    const bad = connect(url, { auth: { token: 'nope' }, transports: ['websocket'] });
    sockets.push(bad);
    await expect(new Promise((res, rej) => (bad.on('connect', () => res(true)), bad.on('connect_error', rej)))).rejects.toThrow('unauthorized');

    const admin = await passwordUser('admin');
    const c = await customer();
    const sock = connect(url, { auth: { token: c.token }, transports: ['websocket'] });
    sockets.push(sock);
    await new Promise<void>((r) => sock.on('connect', () => r()));

    const created = await api()
      .post(`${v1}/bookings`)
      .set(auth(c.token))
      .send({ service: 'gunman', plan: 'hourly', hours: 4, asap: true, location: { address: 'Clifton' } })
      .expect(201);

    const got = new Promise<{ status: string }>((r) => sock.on('booking:updated', r));
    await api().post(`${v1}/bookings/${created.body.booking.id}/status`).set(auth(admin.token)).send({ to: 'paid' }).expect(200);
    expect((await got).status).toBe('assigning');

    const watch = await sock.emitWithAck('booking:watch', created.body.booking.id);
    expect(watch.ok).toBe(true);
  });
});
