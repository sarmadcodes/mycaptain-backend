import bcrypt from 'bcryptjs';
import { Schema, Types, model, type HydratedDocument, type Model } from 'mongoose';

import { normalizePkMobile } from '@/lib/phone';

import { fileRefSchema, toJSON, type FileRef } from './shared';

export const ROLES = ['customer', 'driver', 'guard', 'partner', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export const STAFF_ROLES = ['driver', 'guard'] as const;

export type User = {
  role: Role;
  name: string;
  phone: string;
  email?: string;
  passwordHash?: string;
  status: 'active' | 'suspended';
  // Drivers, guards and partner owners belong to a company.
  company?: Types.ObjectId;
  // Staff only.
  staffKind?: 'driver' | 'guard' | 'gunman';
  available: boolean;
  documents: FileRef[];
  avatarUrl?: string;
  // Incremented to invalidate every access token for this user (password change, suspension).
  tokenVersion: number;
  lastLoginAt?: Date;
};

type Methods = { setPassword(pw: string): Promise<void>; checkPassword(pw: string): Promise<boolean> };
export type UserDoc = HydratedDocument<User, Methods>;

const schema = new Schema<User, Model<User, object, Methods>, Methods>(
  {
    role: { type: String, enum: ROLES, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Always stored as +92XXXXXXXXXX, whatever format the caller used.
    phone: {
      type: String,
      required: true,
      unique: true,
      set: (v: string) => normalizePkMobile(v) ?? v,
      validate: { validator: (v: string) => /^\+923\d{9}$/.test(v), message: 'Enter a valid Pakistani mobile number.' },
    },
    email: { type: String, trim: true, lowercase: true, maxlength: 120, sparse: true, unique: true },
    passwordHash: { type: String, select: false },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    company: { type: Schema.Types.ObjectId, ref: 'Company', index: true },
    staffKind: { type: String, enum: ['driver', 'guard', 'gunman'] },
    available: { type: Boolean, default: true },
    documents: { type: [fileRefSchema], default: [] },
    avatarUrl: String,
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
  },
  {
    timestamps: true,
    toJSON: {
      ...toJSON,
      transform: (_d: unknown, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.passwordHash;
        delete ret.tokenVersion;
        return ret;
      },
    },
  },
);

schema.method('setPassword', async function (this: UserDoc, pw: string) {
  this.passwordHash = await bcrypt.hash(pw, 12);
});

schema.method('checkPassword', async function (this: UserDoc, pw: string) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(pw, this.passwordHash);
});

export const UserModel = model<User, Model<User, object, Methods>>('User', schema);
