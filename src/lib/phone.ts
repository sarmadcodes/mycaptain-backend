import { z } from 'zod';

// Accepts 3001234567, 03001234567, 923001234567 or +923001234567 and returns +923001234567.
export function normalizePkMobile(input: string): string | null {
  const d = input.replace(/[\s-]/g, '').replace(/^\+/, '');
  const local = d.startsWith('92') ? d.slice(2) : d.startsWith('0') ? d.slice(1) : d;
  return /^3\d{9}$/.test(local) ? `+92${local}` : null;
}

export const pkMobile = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizePkMobile(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid Pakistani mobile number.' });
      return z.NEVER;
    }
    return n;
  });
