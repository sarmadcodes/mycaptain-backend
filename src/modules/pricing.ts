import type { Plan, Price, Service } from '@/models/booking';
import type { RateCard } from '@/models/rate-card';
import type { VehicleClass } from '@/models/rental-car';

export type QuoteInput = {
  service: Service;
  plan: Plan;
  hours?: number;
  days?: number;
  contractMonths?: 6 | 12;
  vehicleClass?: VehicleClass;
  // Rental car day rate (car and driver, 8 hours).
  carPerDay?: number;
  // Guards for 'guard'; additional guards for 'team' (plus one armed lead).
  personnel: number;
};

const HOURS_PER_DAY = 8;
const DAYS_PER_MONTH = 26;

export function billableHours(i: QuoteInput) {
  switch (i.plan) {
    case 'hourly':
      return i.hours ?? 1;
    case 'daily':
      return (i.days ?? 1) * HOURS_PER_DAY;
    case 'monthly':
      return DAYS_PER_MONTH * HOURS_PER_DAY;
    case 'contract':
      return (i.contractMonths ?? 6) * DAYS_PER_MONTH * HOURS_PER_DAY;
  }
}

export function hourlyRate(i: QuoteInput, r: Pick<RateCard, 'driverHourly' | 'guardHourly' | 'gunmanHourly'>) {
  switch (i.service) {
    case 'driver':
      return r.driverHourly[i.vehicleClass ?? 'sedan'];
    case 'rental':
      return (i.carPerDay ?? 0) / HOURS_PER_DAY;
    case 'guard':
      return r.guardHourly * i.personnel;
    case 'gunman':
      return r.gunmanHourly;
    case 'team':
      return r.gunmanHourly + r.guardHourly * i.personnel;
  }
}

// Server-side price. The app shows the same numbers, but only this one is charged.
export function quote(i: QuoteInput, r: Pick<RateCard, 'driverHourly' | 'guardHourly' | 'gunmanHourly' | 'planDiscount' | 'feePercent'>): Price {
  const rate = hourlyRate(i, r);
  const hours = billableHours(i);
  const discount = r.planDiscount[i.plan];
  const subtotal = Math.round(rate * hours * discount);
  const fee = Math.round((subtotal * r.feePercent) / 100);
  return { hourlyRate: Math.round(rate), billableHours: hours, discount, subtotal, fee, total: subtotal + fee, currency: 'PKR' };
}
