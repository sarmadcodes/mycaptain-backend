import { Schema, Types, model } from 'mongoose';

import { toJSON } from './shared';

// One active rate card (key 'default'). Admins edit it; every quote reads it.
export type RateCard = {
  key: string;
  driverHourly: { small: number; sedan: number; suv: number; luxury: number };
  guardHourly: number;
  gunmanHourly: number;
  planDiscount: { hourly: number; daily: number; monthly: number; contract: number };
  feePercent: number;
  rentalMinHours: number;
  updatedBy?: Types.ObjectId;
};

export const DEFAULT_RATES: Omit<RateCard, 'key' | 'updatedBy'> = {
  driverHourly: { small: 800, sedan: 900, suv: 1000, luxury: 1400 },
  guardHourly: 700,
  gunmanHourly: 1200,
  planDiscount: { hourly: 1, daily: 0.95, monthly: 0.85, contract: 0.8 },
  feePercent: 5,
  rentalMinHours: 4,
};

const positive = { type: Number, required: true, min: 0 };

const schema = new Schema<RateCard>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    driverHourly: { small: positive, sedan: positive, suv: positive, luxury: positive },
    guardHourly: positive,
    gunmanHourly: positive,
    planDiscount: {
      hourly: { type: Number, min: 0.1, max: 1, required: true },
      daily: { type: Number, min: 0.1, max: 1, required: true },
      monthly: { type: Number, min: 0.1, max: 1, required: true },
      contract: { type: Number, min: 0.1, max: 1, required: true },
    },
    feePercent: { type: Number, min: 0, max: 50, required: true },
    rentalMinHours: { type: Number, min: 1, max: 24, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON },
);

export const RateCardModel = model<RateCard>('RateCard', schema);

export async function currentRates() {
  const found = await RateCardModel.findOne({ key: 'default' }).lean();
  if (found) return found;
  const created = await RateCardModel.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default', ...DEFAULT_RATES } },
    { upsert: true, returnDocument: 'after', lean: true },
  );
  return created!;
}
