import { describe, expect, it } from 'vitest';

import { canTransition } from '@/modules/booking-flow';
import { quote } from '@/modules/pricing';
import { DEFAULT_RATES } from '@/models/rate-card';

describe('pricing', () => {
  it('matches the app for each service', () => {
    expect(quote({ service: 'driver', plan: 'hourly', hours: 4, vehicleClass: 'suv', personnel: 1 }, DEFAULT_RATES).total).toBe(4200);
    expect(quote({ service: 'guard', plan: 'daily', days: 2, personnel: 3 }, DEFAULT_RATES).subtotal).toBe(Math.round(700 * 3 * 16 * 0.95));
    expect(quote({ service: 'rental', plan: 'hourly', hours: 4, carPerDay: 26000, personnel: 1 }, DEFAULT_RATES).total).toBe(13650);
    const c = quote({ service: 'driver', plan: 'contract', contractMonths: 6, vehicleClass: 'sedan', personnel: 1 }, DEFAULT_RATES);
    expect(c.billableHours).toBe(6 * 26 * 8);
    expect(c.discount).toBe(0.8);
  });
});

describe('status rules', () => {
  it('allows only the right roles', () => {
    expect(canTransition('pending_payment', 'paid', 'admin')).toBe(true);
    expect(canTransition('pending_payment', 'paid', 'customer')).toBe(false);
    expect(canTransition('confirmed', 'arriving', 'driver')).toBe(true);
    expect(canTransition('on_duty', 'cancelled', 'customer')).toBe(false);
    expect(canTransition('closed', 'on_duty', 'admin')).toBe(false);
  });
});
