import { Schema, Types, model, type HydratedDocument } from 'mongoose';

import { VEHICLE_CLASSES, type VehicleClass } from './rental-car';
import { toJSON } from './shared';
import { ROLES, type Role } from './user';

export const SERVICES = ['driver', 'rental', 'guard', 'gunman', 'team'] as const;
export type Service = (typeof SERVICES)[number];
export const PLANS = ['hourly', 'daily', 'monthly', 'contract'] as const;
export type Plan = (typeof PLANS)[number];

export const STATUSES = [
  'pending_payment',
  'paid',
  'assigning',
  'confirmed',
  'arriving',
  'on_duty',
  'completed',
  'closed',
  'cancelled',
] as const;
export type BookingStatus = (typeof STATUSES)[number];

export type Price = {
  hourlyRate: number;
  billableHours: number;
  discount: number;
  subtotal: number;
  fee: number;
  total: number;
  currency: 'PKR';
};

export type Booking = {
  code: string;
  customer: Types.ObjectId;
  service: Service;
  plan: Plan;
  startAt: Date;
  asap: boolean;
  hours?: number;
  days?: number;
  contractMonths?: 6 | 12;
  vehicle?: { class: VehicleClass; makeModel?: string; engine?: string; transmission: 'automatic' | 'manual'; notes?: string };
  car?: Types.ObjectId;
  personnel: number;
  location: { address: string; point?: string; lat?: number; lng?: number };
  instructions?: string;
  price: Price;
  status: BookingStatus;
  company?: Types.ObjectId;
  staff: Types.ObjectId[];
  requestedStaff?: Types.ObjectId;
  history: { status: BookingStatus; at: Date; by?: Types.ObjectId; byRole?: Role; note?: string }[];
  cancelReason?: string;
  paidAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
};

export type BookingDoc = HydratedDocument<Booking>;

const schema = new Schema<Booking>(
  {
    code: { type: String, required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    service: { type: String, enum: SERVICES, required: true },
    plan: { type: String, enum: PLANS, required: true },
    startAt: { type: Date, required: true, index: true },
    asap: { type: Boolean, default: false },
    hours: Number,
    days: Number,
    contractMonths: Number,
    vehicle: {
      class: { type: String, enum: VEHICLE_CLASSES },
      makeModel: String,
      engine: String,
      transmission: { type: String, enum: ['automatic', 'manual'] },
      notes: String,
    },
    car: { type: Schema.Types.ObjectId, ref: 'RentalCar' },
    personnel: { type: Number, default: 1, min: 1, max: 50 },
    location: {
      address: { type: String, required: true, maxlength: 200 },
      point: { type: String, maxlength: 100 },
      lat: Number,
      lng: Number,
    },
    instructions: { type: String, maxlength: 1000 },
    price: {
      hourlyRate: Number,
      billableHours: Number,
      discount: Number,
      subtotal: Number,
      fee: Number,
      total: Number,
      currency: { type: String, default: 'PKR' },
    },
    status: { type: String, enum: STATUSES, required: true, index: true },
    company: { type: Schema.Types.ObjectId, ref: 'Company', index: true },
    staff: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
    requestedStaff: { type: Schema.Types.ObjectId, ref: 'User' },
    history: [
      {
        _id: false,
        status: { type: String, enum: STATUSES },
        at: { type: Date, default: () => new Date() },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        byRole: { type: String, enum: ROLES },
        note: String,
      },
    ],
    cancelReason: { type: String, maxlength: 300 },
    paidAt: Date,
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true, toJSON },
);

schema.index({ status: 1, startAt: 1 });

export const BookingModel = model<Booking>('Booking', schema);
