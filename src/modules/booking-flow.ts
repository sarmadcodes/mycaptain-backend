import type { BookingStatus } from '@/models/booking';
import type { Role } from '@/models/user';

// Who may move a booking from one status to another.
// pending_payment -> paid -> assigning -> confirmed -> arriving -> on_duty -> completed -> closed
// cancelled is reachable before the duty starts.
const FLOW: Record<BookingStatus, Partial<Record<BookingStatus, Role[]>>> = {
  pending_payment: { paid: ['admin'], cancelled: ['customer', 'admin'] },
  paid: { assigning: ['admin'], cancelled: ['customer', 'admin'] },
  assigning: { confirmed: ['partner', 'admin'], cancelled: ['customer', 'admin'] },
  confirmed: { arriving: ['driver', 'guard', 'admin'], cancelled: ['customer', 'admin'] },
  arriving: { on_duty: ['driver', 'guard', 'admin'], cancelled: ['admin'] },
  on_duty: { completed: ['driver', 'guard', 'admin'] },
  completed: { closed: ['customer', 'admin'] },
  closed: {},
  cancelled: {},
};

export function canTransition(from: BookingStatus, to: BookingStatus, role: Role) {
  return FLOW[from]?.[to]?.includes(role) ?? false;
}

export function nextStatuses(from: BookingStatus, role: Role): BookingStatus[] {
  return (Object.entries(FLOW[from] ?? {}) as [BookingStatus, Role[]][]).filter(([, roles]) => roles.includes(role)).map(([s]) => s);
}

export const ACTIVE: BookingStatus[] = ['assigning', 'confirmed', 'arriving', 'on_duty'];
