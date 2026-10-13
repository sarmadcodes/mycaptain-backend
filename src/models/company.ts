import { Schema, Types, model, type HydratedDocument } from 'mongoose';

import { fileRefSchema, toJSON, type FileRef } from './shared';

export const COMPANY_SERVICES = ['drivers', 'guards', 'armed', 'teams', 'rentals'] as const;
export const COMPANY_STATUS = ['pending', 'changes_requested', 'approved', 'rejected', 'suspended'] as const;

export type Company = {
  ref: string;
  legalName: string;
  tradingName?: string;
  companyType: string;
  registrationNo: string;
  ntn: string;
  yearEstablished: number;
  city: string;
  address: string;
  services: (typeof COMPANY_SERVICES)[number][];
  cities: string[];
  driverCount?: number;
  guardCount?: number;
  securityLicence?: { number: string; expiry: Date };
  documents: FileRef[];
  contact: { name: string; designation: string; phone: string; email: string };
  owner: Types.ObjectId;
  status: (typeof COMPANY_STATUS)[number];
  reviewNote?: string;
  reviewedBy?: Types.ObjectId;
  approvedAt?: Date;
};

export type CompanyDoc = HydratedDocument<Company>;

const schema = new Schema<Company>(
  {
    ref: { type: String, required: true, unique: true },
    legalName: { type: String, required: true, trim: true, maxlength: 120 },
    tradingName: { type: String, trim: true, maxlength: 120 },
    companyType: { type: String, required: true, maxlength: 40 },
    registrationNo: { type: String, required: true, trim: true, maxlength: 40 },
    ntn: { type: String, required: true, trim: true, maxlength: 20, unique: true },
    yearEstablished: { type: Number, required: true, min: 1900, max: 2100 },
    city: { type: String, required: true, maxlength: 40 },
    address: { type: String, required: true, maxlength: 200 },
    services: { type: [String], enum: COMPANY_SERVICES, default: [] },
    cities: { type: [String], default: [] },
    driverCount: { type: Number, min: 0 },
    guardCount: { type: Number, min: 0 },
    securityLicence: { number: String, expiry: Date },
    documents: { type: [fileRefSchema], default: [] },
    contact: {
      name: { type: String, required: true, maxlength: 80 },
      designation: { type: String, required: true, maxlength: 60 },
      phone: { type: String, required: true },
      email: { type: String, required: true, lowercase: true },
    },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: COMPANY_STATUS, default: 'pending', index: true },
    reviewNote: { type: String, maxlength: 500 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
  },
  { timestamps: true, toJSON },
);

export const CompanyModel = model<Company>('Company', schema);
