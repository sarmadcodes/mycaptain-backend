import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';

import { emit } from '@/lib/realtime';
import { me, requireAuth, requireRole } from '@/middleware/auth';
import { singleFile } from '@/middleware/upload';
import { body, parse } from '@/middleware/validate';
import { BookingModel } from '@/models/booking';
import { CompanyModel } from '@/models/company';
import { currentRates, RateCardModel } from '@/models/rate-card';
import { RentalCarModel, VEHICLE_CLASSES } from '@/models/rental-car';
import { UserModel } from '@/models/user';

import { ACTIVE } from './booking-flow';
import { storeUpload } from './uploads';

export const catalogRouter = Router();

// ---------- Rate card ----------

catalogRouter.get('/rates', async (_req, res) => {
  const r = await currentRates();
  res.json({
    rates: {
      driverHourly: r.driverHourly,
      guardHourly: r.guardHourly,
      gunmanHourly: r.gunmanHourly,
      planDiscount: r.planDiscount,
      feePercent: r.feePercent,
      rentalMinHours: r.rentalMinHours,
    },
  });
});

const amount = z.coerce.number().int().min(0).max(1_000_000);
const discount = z.coerce.number().min(0.1).max(1);

catalogRouter.put(
  '/rates',
  requireAuth,
  requireRole('admin'),
  body(
    z.object({
      driverHourly: z.object({ small: amount, sedan: amount, suv: amount, luxury: amount }),
      guardHourly: amount,
      gunmanHourly: amount,
      planDiscount: z.object({ hourly: discount, daily: discount, monthly: discount, contract: discount }),
      feePercent: z.coerce.number().min(0).max(50),
      rentalMinHours: z.coerce.number().int().min(1).max(24),
    }),
  ),
  async (req, res) => {
    const rates = await RateCardModel.findOneAndUpdate(
      { key: 'default' },
      { $set: { ...req.body, updatedBy: new Types.ObjectId(me(req).id) } },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
    emit('rates:updated', rates.toJSON(), { admins: true });
    res.json({ rates });
  },
);

// ---------- Rental cars (customers browse) ----------

catalogRouter.get('/cars', async (req, res) => {
  const q = parse(z.object({ class: z.enum(VEHICLE_CLASSES).optional(), city: z.string().max(40).optional() }), req.query);
  const companies = await CompanyModel.find({ status: 'approved', services: 'rentals', ...(q.city ? { cities: q.city } : {}) })
    .select('_id legalName tradingName')
    .lean();
  const byId = new Map(companies.map((c) => [String(c._id), c.tradingName || c.legalName]));
  const cars = await RentalCarModel.find({ active: true, company: { $in: [...byId.keys()] }, ...(q.class ? { class: q.class } : {}) })
    .sort({ perDay: 1 })
    .lean();
  res.json({
    cars: cars.map(({ _id, company, ...c }) => ({ ...c, id: String(_id), companyName: byId.get(String(company)) })),
  });
});

// ---------- Uploads (evidence photos, avatars) ----------

catalogRouter.post('/uploads', requireAuth, singleFile, async (req, res) => {
  const { purpose } = parse(z.object({ purpose: z.enum(['evidence', 'avatar']) }), req.body);
  const u = me(req);
  const stored = await storeUpload(req, `${purpose}/${u.id}`, purpose === 'evidence');
  if (purpose === 'avatar') await UserModel.updateOne({ _id: u.id }, { $set: { avatarUrl: stored.url } });
  res.status(201).json({ file: { url: stored.url, publicId: stored.publicId, resourceType: stored.resourceType } });
});

// ---------- Admin overview numbers ----------

catalogRouter.get('/admin/overview', requireAuth, requireRole('admin'), async (_req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [active, arriving, waiting, pendingPartners, paidToday] = await Promise.all([
    BookingModel.countDocuments({ status: 'on_duty' }),
    BookingModel.countDocuments({ status: 'arriving' }),
    BookingModel.countDocuments({ status: 'assigning' }),
    CompanyModel.countDocuments({ status: 'pending' }),
    BookingModel.aggregate<{ total: number }>([
      { $match: { paidAt: { $gte: startOfDay } } },
      { $group: { _id: null, total: { $sum: '$price.total' } } },
    ]),
  ]);
  const live = await BookingModel.find({ status: { $in: ACTIVE } })
    .sort({ startAt: 1 })
    .limit(20)
    .populate([
      { path: 'staff', select: 'name staffKind' },
      { path: 'company', select: 'legalName' },
    ]);
  res.json({
    kpis: { activeDuties: active, arriving, awaitingAssignment: waiting, pendingPartners, paidToday: paidToday[0]?.total ?? 0 },
    live,
  });
});
