import { Router } from 'express';
import { Types, type QueryFilter } from 'mongoose';
import { z } from 'zod';

import { AppError, badRequest, notFound } from '@/lib/errors';
import { emit } from '@/lib/realtime';
import { me, requireAuth, requireRole, type AuthUser } from '@/middleware/auth';
import { body, parse } from '@/middleware/validate';
import { BookingModel, PLANS, SERVICES, STATUSES, type Booking, type BookingDoc, type BookingStatus } from '@/models/booking';
import { CompanyModel } from '@/models/company';
import { currentRates } from '@/models/rate-card';
import { RentalCarModel, VEHICLE_CLASSES } from '@/models/rental-car';
import { nextRef } from '@/models/shared';
import { UserModel } from '@/models/user';

import { canTransition, nextStatuses } from './booking-flow';
import { quote, type QuoteInput } from './pricing';

export const bookingsRouter = Router();

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id.');

const bookingInput = z
  .object({
    service: z.enum(SERVICES),
    plan: z.enum(PLANS),
    asap: z.boolean().default(false),
    startAt: z.coerce.date().optional(),
    hours: z.coerce.number().int().min(1).max(24).optional(),
    days: z.coerce.number().int().min(1).max(30).optional(),
    contractMonths: z.union([z.literal(6), z.literal(12)]).optional(),
    vehicle: z
      .object({
        class: z.enum(VEHICLE_CLASSES),
        makeModel: z.string().trim().max(60).optional(),
        engine: z.string().trim().max(20).optional(),
        transmission: z.enum(['automatic', 'manual']),
        notes: z.string().trim().max(300).optional(),
      })
      .optional(),
    carId: objectId.optional(),
    personnel: z.coerce.number().int().min(1).max(50).default(1),
    location: z.object({
      address: z.string().trim().min(4, 'Enter the address.').max(200),
      point: z.string().trim().max(100).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
    }),
    instructions: z.string().trim().max(1000).optional(),
    requestedStaffId: objectId.optional(),
  })
  .superRefine((v, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.plan === 'hourly' && !v.hours) add('hours', 'Choose how many hours.');
    if (v.plan === 'daily' && !v.days) add('days', 'Choose how many days.');
    if (v.plan === 'contract' && !v.contractMonths) add('contractMonths', 'Choose the contract length.');
    if (v.service === 'driver' && !v.vehicle) add('vehicle', 'Tell us about your vehicle.');
    if (v.service === 'rental' && !v.carId) add('carId', 'Choose a car.');
    if (v.service === 'rental' && v.plan === 'contract') add('plan', 'Rentals are hourly, daily or monthly.');
    if (v.service === 'gunman' && v.personnel !== 1) add('personnel', 'Book one armed gunman, or choose a security team.');
    const longTerm = v.plan === 'monthly' || v.plan === 'contract';
    if ((!v.asap || longTerm) && !v.startAt) add('startAt', 'Choose a start date and time.');
  });

type BookingInput = z.infer<typeof bookingInput>;

// Resolves rates, car and start time; returns everything needed to price and store a booking.
async function prepare(v: BookingInput) {
  const rates = await currentRates();
  let carPerDay: number | undefined;
  let car: Types.ObjectId | undefined;
  if (v.service === 'rental') {
    const c = await RentalCarModel.findOne({ _id: v.carId, active: true }).lean();
    if (!c) throw badRequest('This car is no longer available.');
    const company = await CompanyModel.findById(c.company).select('status').lean();
    if (company?.status !== 'approved') throw badRequest('This car is no longer available.');
    if (v.plan === 'hourly' && (v.hours ?? 0) < rates.rentalMinHours) {
      throw badRequest(`Rentals are at least ${rates.rentalMinHours} hours.`);
    }
    carPerDay = c.perDay;
    car = c._id;
  }

  const longTerm = v.plan === 'monthly' || v.plan === 'contract';
  const now = Date.now();
  let startAt: Date;
  if (v.asap && !longTerm) {
    startAt = new Date(now + 30 * 60_000);
  } else {
    startAt = v.startAt!;
    if (startAt.getTime() < now + 55 * 60_000) throw badRequest('Scheduled bookings need at least one hour of notice.');
    if (startAt.getTime() > now + 92 * 24 * 3600_000) throw badRequest('Bookings can be made up to 90 days ahead.');
  }

  const q: QuoteInput = {
    service: v.service,
    plan: v.plan,
    hours: v.hours,
    days: v.days,
    contractMonths: v.contractMonths,
    vehicleClass: v.vehicle?.class,
    carPerDay,
    personnel: v.personnel,
  };
  return { price: quote(q, rates), startAt, car, asap: v.asap && !longTerm };
}

// What every party sees. Phone numbers stay private (chat and calls go through the platform).
async function view(b: BookingDoc) {
  await b.populate([
    { path: 'staff', select: 'name staffKind avatarUrl role' },
    { path: 'company', select: 'legalName tradingName ref' },
    { path: 'car', select: 'name class seats transmission perDay' },
    { path: 'customer', select: 'name' },
  ]);
  return b.toJSON();
}

function canSee(b: Pick<Booking, 'customer' | 'company' | 'staff'>, u: AuthUser) {
  if (u.role === 'admin') return true;
  if (u.role === 'customer') return String(b.customer) === u.id;
  if (u.role === 'partner') return !!u.company && String(b.company) === u.company;
  return b.staff.some((s) => String(s) === u.id);
}

// Id of a ref whether or not it has been populated.
const refId = (r: unknown) => String((r as { _id?: Types.ObjectId })?._id ?? r);

async function broadcast(b: BookingDoc, event = 'booking:updated') {
  // Work out recipients before view() populates the refs.
  const to = {
    users: [refId(b.customer), ...b.staff.map(refId)],
    companies: b.company ? [refId(b.company)] : [],
    admins: true,
    booking: b.id as string,
  };
  const payload = await view(b);
  emit(event, payload, to);
  return payload;
}

async function load(id: string, u: AuthUser) {
  const b = await BookingModel.findById(id);
  if (!b || !canSee(b, u)) throw notFound('Booking');
  return b;
}

function pushHistory(b: BookingDoc, status: BookingStatus, u: AuthUser, note?: string) {
  b.status = status;
  b.history.push({ status, at: new Date(), by: new Types.ObjectId(u.id), byRole: u.role, note });
}

// ---------- Routes ----------

// Price preview. Same calculation the booking uses.
bookingsRouter.post('/quote', requireAuth, body(bookingInput), async (req, res) => {
  const { price, startAt } = await prepare(req.body as BookingInput);
  res.json({ price, startAt });
});

bookingsRouter.post('/', requireAuth, requireRole('customer'), body(bookingInput), async (req, res) => {
  const v = req.body as BookingInput;
  const u = me(req);
  const { price, startAt, car, asap } = await prepare(v);

  let requestedStaff: Types.ObjectId | undefined;
  if (v.requestedStaffId) {
    const s = await UserModel.findOne({ _id: v.requestedStaffId, role: { $in: ['driver', 'guard'] }, status: 'active' }).select('_id').lean();
    requestedStaff = s?._id;
  }

  const booking = await BookingModel.create({
    code: await nextRef('booking', 'MC', 2047),
    customer: u.id,
    service: v.service,
    plan: v.plan,
    startAt,
    asap,
    hours: v.hours,
    days: v.days,
    contractMonths: v.contractMonths,
    vehicle: v.vehicle,
    car,
    personnel: v.personnel,
    location: v.location,
    instructions: v.instructions,
    price,
    status: 'pending_payment',
    staff: [],
    requestedStaff,
    history: [{ status: 'pending_payment', at: new Date(), by: u.id, byRole: u.role }],
  });
  res.status(201).json({ booking: await broadcast(booking, 'booking:created') });
});

bookingsRouter.get('/', requireAuth, async (req, res) => {
  const u = me(req);
  const q = parse(
    z.object({
      status: z
        .string()
        .optional()
        .transform((s) => s?.split(',').filter(Boolean))
        .pipe(z.array(z.enum(STATUSES)).optional()),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
    req.query,
  );
  const filter: QueryFilter<Booking> = {};
  if (u.role === 'customer') filter.customer = u.id;
  else if (u.role === 'partner') filter.company = u.company;
  else if (u.role === 'driver' || u.role === 'guard') filter.staff = u.id;
  if (q.status?.length) filter.status = { $in: q.status };

  const [items, total] = await Promise.all([
    BookingModel.find(filter)
      .sort({ startAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate([
        { path: 'staff', select: 'name staffKind avatarUrl' },
        { path: 'company', select: 'legalName tradingName' },
        { path: 'car', select: 'name class' },
        { path: 'customer', select: 'name' },
      ]),
    BookingModel.countDocuments(filter),
  ]);
  res.json({ items, total, page: q.page });
});

bookingsRouter.get('/:id', requireAuth, async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const u = me(req);
  const b = await load(id, u);
  res.json({ booking: await view(b), next: nextStatuses(b.status, u.role) });
});

// Status changes: cancel, arriving, on_duty, completed, closed, and (until payments) mark paid.
bookingsRouter.post(
  '/:id/status',
  requireAuth,
  body(z.object({ to: z.enum(STATUSES), note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    const { id } = parse(z.object({ id: objectId }), req.params);
    const { to, note } = req.body as { to: BookingStatus; note?: string };
    const u = me(req);
    const b = await load(id, u);

    if (!canTransition(b.status, to, u.role)) {
      throw new AppError(409, 'invalid_transition', `This booking cannot move from ${b.status.replace('_', ' ')} to ${to.replace('_', ' ')}.`);
    }
    if (to === 'cancelled' && !note) throw badRequest('Give a reason for cancelling.');

    pushHistory(b, to, u, note);
    if (to === 'cancelled') b.cancelReason = note;
    if (to === 'on_duty') b.startedAt = new Date();
    if (to === 'completed') b.completedAt = new Date();
    if (to === 'paid') {
      // TODO(phase 4): set by the payment provider webhook, not manually.
      b.paidAt = new Date();
      pushHistory(b, 'assigning', u, 'Waiting for partner assignment');
    }
    await b.save();
    res.json({ booking: await broadcast(b) });
  },
);

// Admin hands the booking to a partner company.
bookingsRouter.post(
  '/:id/assign-company',
  requireAuth,
  requireRole('admin'),
  body(z.object({ companyId: objectId })),
  async (req, res) => {
    const { id } = parse(z.object({ id: objectId }), req.params);
    const u = me(req);
    const b = await load(id, u);
    if (b.status !== 'assigning') throw new AppError(409, 'invalid_state', 'Only bookings waiting for assignment can be given to a company.');
    const company = await CompanyModel.findOne({ _id: (req.body as { companyId: string }).companyId, status: 'approved' }).select('_id legalName services');
    if (!company) throw badRequest('Choose an approved partner company.');
    const needs = b.service === 'driver' ? 'drivers' : b.service === 'rental' ? 'rentals' : b.service === 'guard' ? 'guards' : 'armed';
    if (!company.services.includes(needs) && !(needs === 'armed' && company.services.includes('teams'))) {
      throw badRequest(`${company.legalName} does not offer this service.`);
    }
    if (b.service === 'rental' && b.car) {
      const car = await RentalCarModel.findById(b.car).select('company').lean();
      if (car && String(car.company) !== company.id) throw badRequest('Rental bookings go to the company that owns the car.');
    }
    b.company = company._id;
    b.staff = [];
    b.history.push({ status: b.status, at: new Date(), by: new Types.ObjectId(u.id), byRole: u.role, note: `Assigned to ${company.legalName}` });
    await b.save();
    res.json({ booking: await broadcast(b) });
  },
);

// The partner (or admin) picks the people for the job. Confirms the booking.
bookingsRouter.post(
  '/:id/assign-staff',
  requireAuth,
  requireRole('partner', 'admin'),
  body(z.object({ staffIds: z.array(objectId).min(1).max(50) })),
  async (req, res) => {
    const { id } = parse(z.object({ id: objectId }), req.params);
    const u = me(req);
    const b = await load(id, u);
    if (!b.company) throw new AppError(409, 'invalid_state', 'Assign a company first.');
    if (!['assigning', 'confirmed'].includes(b.status)) throw new AppError(409, 'invalid_state', 'Staff can only be changed before the duty starts.');

    const ids = [...new Set((req.body as { staffIds: string[] }).staffIds)];
    const staff = await UserModel.find({ _id: { $in: ids }, company: b.company, status: 'active', role: { $in: ['driver', 'guard'] } })
      .select('role staffKind')
      .lean();
    if (staff.length !== ids.length) throw badRequest('Choose active staff from the assigned company.');

    const drivers = staff.filter((s) => s.role === 'driver').length;
    const gunmen = staff.filter((s) => s.staffKind === 'gunman').length;
    const guards = staff.filter((s) => s.staffKind === 'guard').length;
    const rule: Record<string, [boolean, string]> = {
      driver: [drivers === 1 && staff.length === 1, 'Assign exactly one driver.'],
      rental: [drivers === 1 && staff.length === 1, 'Assign exactly one driver.'],
      guard: [guards === b.personnel && staff.length === b.personnel, `Assign ${b.personnel} unarmed guard(s).`],
      gunman: [gunmen === 1 && staff.length === 1, 'Assign one armed gunman.'],
      team: [gunmen >= 1 && staff.length === b.personnel + 1, `Assign one armed lead and ${b.personnel} guard(s).`],
    };
    const [ok, message] = rule[b.service]!;
    if (!ok) throw badRequest(message);

    const before = b.staff.map(String);
    b.staff = staff.map((s) => s._id);
    if (b.status === 'assigning') pushHistory(b, 'confirmed', u, 'Staff assigned');
    else b.history.push({ status: b.status, at: new Date(), by: new Types.ObjectId(u.id), byRole: u.role, note: 'Staff changed' });
    await b.save();

    // Removed staff lose the booking from their list.
    const removed = before.filter((s) => !ids.includes(s));
    if (removed.length) emit('booking:removed', { id: b.id }, { users: removed });
    res.json({ booking: await broadcast(b) });
  },
);
