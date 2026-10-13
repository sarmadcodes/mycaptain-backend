import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

import { env } from '@/config/env';

import { AppError } from './errors';

const configured = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

if (configured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export type StoredFile = { url: string; publicId: string; format: string; bytes: number; resourceType: string };

// Uploads land in authenticated (private) delivery for documents, so URLs are not guessable.
export async function uploadBuffer(
  buffer: Buffer,
  opts: { folder: string; privateDoc?: boolean; filename?: string },
): Promise<StoredFile> {
  if (!configured) throw new AppError(503, 'storage_unavailable', 'File storage is not configured.');
  const res = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `my-captain/${opts.folder}`,
        resource_type: 'auto',
        type: opts.privateDoc ? 'authenticated' : 'upload',
        use_filename: false,
        unique_filename: true,
        overwrite: false,
      },
      (err, result) => (err || !result ? reject(err ?? new Error('Empty upload response')) : resolve(result)),
    );
    stream.end(buffer);
  });
  return { url: res.secure_url, publicId: res.public_id, format: res.format, bytes: res.bytes, resourceType: res.resource_type };
}

// Short-lived signed link for viewing a private document.
export function signedUrl(publicId: string, resourceType = 'image', ttlSec = 600) {
  if (!configured) return undefined;
  return cloudinary.url(publicId, {
    type: 'authenticated',
    resource_type: resourceType,
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + ttlSec,
  });
}

export async function destroyFile(publicId: string, resourceType = 'image', privateDoc = false) {
  if (!configured) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: privateDoc ? 'authenticated' : 'upload' });
}
