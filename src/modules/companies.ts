import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';

import { signedUrl } from '@/lib/cloudinary';
import { AppError, badRequest, forbidden, notFound } from '@/lib/errors';
import { pkMobile } from '@/lib/phone';
import { emit } from '@/lib/realtime';
import { me, requireAuth, requireRole } from '@/middleware/auth';
import { authLimiter } from '@/middleware/rate-limit';
import { singleFile } from '@/middleware/upload';
import { body, parse } from '@/middleware/validate';
import { COMPANY_SERVICES, CompanyModel, type CompanyDoc } from '@/models/company';
import { VEHICLE_CLASSES, RentalCarModel } from '@/models/rental-car';
import { nextRef } from '@/models/shared';
import { UserModel } from '@/models/user';

import { issueSession } from './auth';
import { storeUpload, toFileRef } from './uploads';

export const companiesRouter = Router();

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id.');
const password = z.string().min(8, 'Use at least 8 characters.').max(200);

// ---------- Public: partner application (from the partner website) ----------

const applicationSchema = z
  .object({
    legalName: z.string().trim().min(3).max(120),
    tradingName: z.string().trim().max(120).optional(),
    companyType: z.enum(['private-limited', 'partnership', 'sole-proprietor', 'public-limited']),
    registrationNo: z.string().trim().min(4).max(40),
    ntn: z.string().trim().regex(/^\d{7}(-\d)?$/, 'NTN looks like 1234567 or 1234567-8.'),
    yearEstablished: z.coerce.number().int().min(1900).max(new Date().getFullYear()),
    city: z.string().trim().min(2).max(40),
    address: z.string().trim().min(8).max(200),
    services: z.array(z.enum(COMPANY_SERVICES)).min(1, 'Choose at least one service.'),
    cities: z.array(z.string().trim().min(2).max(40)).min(1).max(20),
    driverCount: z.coerce.number().int().min(0).max(100_000).optional(),
    guardCount: z.coerce.number().int().min(0).max(100_000).optional(),
    securityLicence: z.object({ number: z.string().trim().min(3).max(40), expiry: z.coerce.date() }).optional(),
    contact: z.object({
      name: z.string().trim().min(3).max(80),
      designation: z.string().trim().min(2).max(60),
      phone: pkMobile,
      email: z.email().max(120),
    }),
    password,
  })
  .superRefine((v, ctx) => {
    const security = v.services.some((s) => s === 'guards' || s === 'armed' || s === 'teams');
    if (security && !v.securityLicence) ctx.addIssue({ code: 'custom', path: ['securityLicence'], message: 'Security companies need a licence.' });
    if (v.securityLicence && v.securityLicence.expiry < new Date()) {
      ctx.addIssue({ code: 'custom', path: ['securityLicence', 'expiry'], message: 'The security licence has expired.' });
    }
  });

// Creates the partner owner account and the company (status pending). Returns a session so
// the partner can upload documents right away.
companiesRouter.post('/applications', authLimiter, body(applicationSchema), async (req, res) => {
  const v = req.body as z.infer<typeof applicationSchema>;
  if (await UserModel.exists({ $or: [{ phone: v.contact.phone }, { email: v.contact.email }] })) {
    throw new AppError(409, 'account_exists', 'An account with this phone or email already exists. Sign in instead.');
  }
  const ownerId = new Types.ObjectId();
  const company = await CompanyModel.create({
    ...v,
    ref: await nextRef('company', 'MCP', 100000),
    owner: ownerId,
    documents: [],
    status: 'pending',
  });
  const owner = new UserModel({
    _id: ownerId,
    role: 'partner',
    name: v.contact.name,
    phone: v.contact.phone,
    email: v.contact.email,
    company: company._id,
  });
  await owner.setPassword(v.password);
  try {
    await owner.save();
  } catch (e) {
    await company.deleteOne();
    throw e;
  }
  emit('company:new', publicCompany(company), { admins: true });
  res.status(201).json({ company: publicCompany(company), ...(await issueSession(owner)) });
});

// ---------- Partner: own company ----------

const partner = [requireAuth, requireRole('partner')];

async function myCompany(companyId?: string) {
  if (!companyId) throw forbidden();
  const c = await CompanyModel.findById(companyId);
  if (!c) throw notFound('Company');
  return c;
}

function publicCompany(c: CompanyDoc) {
  const json = c.toJSON() as Record<string, unknown>;
  // Document links are private; signed URLs are issued per request.
  json.documents = c.documents.map((d) => ({
    id: String((d as unknown as { _id: Types.ObjectId })._id),
    kind: d.kind,
    status: d.status,
    note: d.note,
    uploadedAt: d.uploadedAt,
    viewUrl: signedUrl(d.publicId, d.resourceType),
  }));
  return json;
}

companiesRouter.get('/me', ...partner, async (req, res) => {
  res.json({ company: publicCompany(await myCompany(me(req).company)) });
});

const DOC_KINDS = ['registration', 'ntn', 'security_licence', 'other'] as const;

companiesRouter.post('/me/documents', ...partner, singleFile, async (req, res) => {
  const { kind } = parse(z.object({ kind: z.enum(DOC_KINDS) }), req.body);
  const company = await myCompany(me(req).company);
  const stored = await storeUpload(req, `companies/${company.id}`, true);
  // Replace an earlier upload of the same kind so reviewers see the latest.
  company.documents = company.documents.filter((d) => d.kind !== kind) as typeof company.documents;
  company.documents.push(toFileRef(kind, stored));
  if (company.status === 'changes_requested') company.status = 'pending';
  await company.save();
  emit('company:updated', publicCompany(company), { admins: true, companies: [company.id] });
  res.status(201).json({ company: publicCompany(company) });
});

// Staff management. Partners create logins for their drivers and guards.
const staffCreate = z.object({
  name: z.string().trim().min(2).max(80),
  phone: pkMobile,
  staffKind: z.enum(['driver', 'guard', 'gunman']),
  password,
});

companiesRouter.get('/me/staff', ...partner, async (req, res) => {
  const staff = await UserModel.find({ company: me(req).company, role: { $in: ['driver', 'guard'] } }).sort({ name: 1 });
  res.json({ staff });
});

companiesRouter.post('/me/staff', ...partner, body(staffCreate), async (req, res) => {
  const company = await myCompany(me(req).company);
  if (company.status !== 'approved') throw new AppError(403, 'company_pending', 'You can add staff once your company is approved.');
  const v = req.body as z.infer<typeof staffCreate>;
  const user = new UserModel({
    role: v.staffKind === 'driver' ? 'driver' : 'guard',
    staffKind: v.staffKind,
    name: v.name,
    phone: v.phone,
    company: company._id,
  });
  await user.setPassword(v.password);
  await user.save();
  res.status(201).json({ staff: user });
});

companiesRouter.patch(
  '/me/staff/:id',
  ...partner,
  body(z.object({ name: z.string().trim().min(2).max(80).optional(), status: z.enum(['active', 'suspended']).optional(), password: password.optional() })),
  async (req, res) => {
    const { id } = parse(z.object({ id: objectId }), req.params);
    const user = await UserModel.findOne({ _id: id, company: me(req).company, role: { $in: ['driver', 'guard'] } });
    if (!user) throw notFound('Staff member');
    const v = req.body as { name?: string; status?: 'active' | 'suspended'; password?: string };
    if (v.name) user.name = v.name;
    if (v.status && v.status !== user.status) {
      user.status = v.status;
      user.tokenVersion += 1; // signs the person out everywhere
    }
    if (v.password) {
      await user.setPassword(v.password);
      user.tokenVersion += 1;
    }
    await user.save();
    res.json({ staff: user });
  },
);

companiesRouter.post('/me/staff/:id/documents', ...partner, singleFile, async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const { kind } = parse(z.object({ kind: z.enum(['cnic', 'driving_licence', 'arms_licence', 'police_certificate', 'medical', 'training']) }), req.body);
  const user = await UserModel.findOne({ _id: id, company: me(req).company });
  if (!user) throw notFound('Staff member');
  const stored = await storeUpload(req, `staff/${user.id}`, true);
  user.documents = user.documents.filter((d) => d.kind !== kind) as typeof user.documents;
  user.documents.push(toFileRef(kind, stored));
  await user.save();
  res.status(201).json({ staff: user });
});

// Rental fleet.
const carSchema = z.object({
  name: z.string().trim().min(2).max(60),
  class: z.enum(VEHICLE_CLASSES),
  seats: z.coerce.number().int().min(2).max(15),
  transmission: z.enum(['automatic', 'manual']),
  perDay: z.coerce.number().int().min(1000).max(500_000),
  features: z.string().trim().max(120).optional(),
  active: z.boolean().optional(),
});

companiesRouter.get('/me/cars', ...partner, async (req, res) => {
  res.json({ cars: await RentalCarModel.find({ company: me(req).company }).sort({ perDay: 1 }) });
});

companiesRouter.post('/me/cars', ...partner, body(carSchema), async (req, res) => {
  const company = await myCompany(me(req).company);
  if (!company.services.includes('rentals')) throw badRequest('Add rentals to your services to list cars.');
  res.status(201).json({ car: await RentalCarModel.create({ ...req.body, company: company._id }) });
});

companiesRouter.patch('/me/cars/:id', ...partner, body(carSchema.partial()), async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const car = await RentalCarModel.findOneAndUpdate({ _id: id, company: me(req).company }, { $set: req.body }, { returnDocument: 'after', runValidators: true });
  if (!car) throw notFound('Car');
  res.json({ car });
});

// ---------- Admin: review applications ----------

const admin = [requireAuth, requireRole('admin')];

companiesRouter.get('/', ...admin, async (req, res) => {
  const q = parse(
    z.object({
      status: z.enum(['pending', 'changes_requested', 'approved', 'rejected', 'suspended']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
    req.query,
  );
  const filter = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    CompanyModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
    CompanyModel.countDocuments(filter),
  ]);
  res.json({ items: items.map(publicCompany), total, page: q.page });
});

companiesRouter.get('/:id', ...admin, async (req, res) => {
  const { id } = parse(z.object({ id: objectId }), req.params);
  const company = await CompanyModel.findById(id);
  if (!company) throw notFound('Company');
  const staffCount = await UserModel.countDocuments({ company: company._id, role: { $in: ['driver', 'guard'] } });
  res.json({ company: publicCompany(company), staffCount });
});

companiesRouter.post(
  '/:id/review',
  ...admin,
  body(z.object({ decision: z.enum(['approve', 'request_changes', 'reject', 'suspend']), note: z.string().trim().max(500).optional() })),
  async (req, res) => {
    const { id } = parse(z.object({ id: objectId }), req.params);
    const { decision, note } = req.body as { decision: 'approve' | 'request_changes' | 'reject' | 'suspend'; note?: string };
    const company = await CompanyModel.findById(id);
    if (!company) throw notFound('Company');

    if (decision === 'approve') {
      const kinds = new Set(company.documents.map((d) => d.kind));
      const needed = ['registration', 'ntn', ...(company.securityLicence ? ['security_licence'] : [])];
      const missing = needed.filter((k) => !kinds.has(k));
      if (missing.length) throw badRequest(`Missing documents: ${missing.join(', ')}.`, { missing });
      company.documents.forEach((d) => (d.status = 'verified'));
      company.approvedAt = new Date();
    }
    if (decision !== 'approve' && !note) throw badRequest('Add a note explaining the decision.');

    company.status = ({ approve: 'approved', request_changes: 'changes_requested', reject: 'rejected', suspend: 'suspended' } as const)[decision];
    company.reviewNote = note;
    company.reviewedBy = new Types.ObjectId(me(req).id);
    await company.save();

    // Suspending a company signs out all of its staff.
    if (decision === 'suspend') await UserModel.updateMany({ company: company._id }, { $inc: { tokenVersion: 1 } });

    emit('company:updated', publicCompany(company), { admins: true, companies: [company.id] });
    res.json({ company: publicCompany(company) });
  },
);
