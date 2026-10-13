import type { Server as HttpServer } from 'node:http';

import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';

import { env } from '@/config/env';
import { BookingModel } from '@/models/booking';
import { UserModel } from '@/models/user';

import { redis } from './kv';
import { logger } from './logger';
import { verifyAccess } from './tokens';

let io: Server | undefined;

// Rooms: user:<id>, company:<id>, admins, booking:<id>.
export function attachRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  if (redis) {
    const sub = redis.duplicate();
    io.adapter(createAdapter(redis, sub));
  }

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string })?.token;
      if (!token) return next(new Error('unauthorized'));
      const claims = verifyAccess(token);
      const user = await UserModel.findById(claims.sub).select('role status tokenVersion company').lean();
      if (!user || user.status !== 'active' || user.tokenVersion !== claims.tv) return next(new Error('unauthorized'));
      socket.data.user = { id: String(user._id), role: user.role, company: user.company ? String(user.company) : undefined };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const u = socket.data.user as { id: string; role: string; company?: string };
    socket.join(`user:${u.id}`);
    if (u.company) socket.join(`company:${u.company}`);
    if (u.role === 'admin') socket.join('admins');

    // Follow a booking's live updates; only parties to the booking may join.
    socket.on('booking:watch', async (bookingId: unknown, ack?: (r: { ok: boolean }) => void) => {
      try {
        if (typeof bookingId !== 'string' || !/^[a-f\d]{24}$/i.test(bookingId)) return ack?.({ ok: false });
        const b = await BookingModel.findById(bookingId).select('customer company staff').lean();
        const allowed =
          !!b &&
          (u.role === 'admin' ||
            String(b.customer) === u.id ||
            (u.company && String(b.company) === u.company) ||
            b.staff.some((s) => String(s) === u.id));
        if (allowed) socket.join(`booking:${bookingId}`);
        ack?.({ ok: allowed });
      } catch {
        ack?.({ ok: false });
      }
    });
    socket.on('booking:unwatch', (bookingId: unknown) => {
      if (typeof bookingId === 'string') socket.leave(`booking:${bookingId}`);
    });
  });

  logger.info('realtime ready');
  return io;
}

export async function closeRealtime() {
  await io?.close();
  io = undefined;
}

type Target = { users?: string[]; companies?: string[]; admins?: boolean; booking?: string };

// Emits one event to every room in the target, without duplicates per socket.
export function emit(event: string, payload: unknown, to: Target) {
  if (!io) return;
  const rooms = [
    ...(to.users ?? []).map((id) => `user:${id}`),
    ...(to.companies ?? []).map((id) => `company:${id}`),
    ...(to.admins ? ['admins'] : []),
    ...(to.booking ? [`booking:${to.booking}`] : []),
  ];
  if (rooms.length) io.to(rooms).emit(event, payload);
}
