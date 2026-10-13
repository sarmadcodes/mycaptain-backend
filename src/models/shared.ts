import { Schema, model, type HydratedDocument } from 'mongoose';

// Uploaded file reference (Cloudinary). Documents are reviewed by admins or partners.
export type FileRef = {
  kind: string;
  url: string;
  publicId: string;
  resourceType: string;
  status: 'pending' | 'verified' | 'rejected';
  note?: string;
  uploadedAt: Date;
};

export const fileRefSchema = new Schema<FileRef>(
  {
    kind: { type: String, required: true, trim: true, maxlength: 60 },
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    resourceType: { type: String, default: 'image' },
    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    note: { type: String, maxlength: 300 },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);

// Consistent JSON: `id` instead of `_id`, no `__v`.
export const toJSON = {
  virtuals: true,
  versionKey: false,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret._id;
    return ret;
  },
};

// Human-readable sequential references: MC-2048, MCP-100001.
const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = model('Counter', counterSchema);

export async function nextRef(name: 'booking' | 'company', prefix: string, start: number) {
  const c = (await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })) as HydratedDocument<{
    seq: number;
  }>;
  return `${prefix}-${start + c.seq}`;
}
