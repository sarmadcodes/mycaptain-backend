import type { Request } from 'express';

import { uploadBuffer, type StoredFile } from '@/lib/cloudinary';
import { badRequest } from '@/lib/errors';
import { looksValid } from '@/middleware/upload';
import type { FileRef } from '@/models/shared';

// Validates the multer file and stores it on Cloudinary.
export async function storeUpload(req: Request, folder: string, privateDoc: boolean): Promise<StoredFile> {
  const file = req.file;
  if (!file) throw badRequest('Attach a file in the "file" field.');
  if (!looksValid(file.buffer, file.mimetype)) throw badRequest('The file content does not match its type.');
  return uploadBuffer(file.buffer, { folder, privateDoc });
}

export function toFileRef(kind: string, f: StoredFile): FileRef {
  return { kind, url: f.url, publicId: f.publicId, resourceType: f.resourceType, status: 'pending', uploadedAt: new Date() };
}
