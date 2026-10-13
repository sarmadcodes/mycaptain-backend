import { Schema, Types, model } from 'mongoose';

import { toJSON } from './shared';

export const VEHICLE_CLASSES = ['small', 'sedan', 'suv', 'luxury'] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

// Partner fleet car offered as "rent a car with a driver". Day rate covers car and driver for 8 hours.
export type RentalCar = {
  company: Types.ObjectId;
  name: string;
  class: VehicleClass;
  seats: number;
  transmission: 'automatic' | 'manual';
  perDay: number;
  features?: string;
  imageUrl?: string;
  active: boolean;
};

const schema = new Schema<RentalCar>(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    class: { type: String, enum: VEHICLE_CLASSES, required: true },
    seats: { type: Number, required: true, min: 2, max: 15 },
    transmission: { type: String, enum: ['automatic', 'manual'], required: true },
    perDay: { type: Number, required: true, min: 1000, max: 500_000 },
    features: { type: String, maxlength: 120 },
    imageUrl: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON },
);

export const RentalCarModel = model<RentalCar>('RentalCar', schema);
