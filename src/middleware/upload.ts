import multer from 'multer';

import { badRequest } from '@/lib/errors';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

// Single file in memory, streamed to Cloudinary. 10 MB, images and PDF only.
export const singleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(badRequest('Upload a JPG, PNG, WEBP, HEIC or PDF file.'));
    cb(null, true);
  },
}).single('file');

// Checks magic bytes so a renamed file cannot pass the MIME check.
export function looksValid(buf: Buffer, mime: string) {
  const hex = buf.subarray(0, 12).toString('hex');
  if (mime === 'application/pdf') return buf.subarray(0, 5).toString() === '%PDF-';
  if (mime === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mime === 'image/png') return hex.startsWith('89504e47');
  if (mime === 'image/webp') return buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  if (mime === 'image/heic' || mime === 'image/heif') return buf.subarray(4, 8).toString() === 'ftyp';
  return false;
}
