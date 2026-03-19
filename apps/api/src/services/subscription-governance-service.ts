import { appError } from "../lib/http";
import { AdminRepository } from "../repositories/admin-repository";
import { BookingRepository } from "../repositories/booking-repository";
import { RuntimeSubscriptionRepository } from "../repositories/super-admin/runtime-subscription-repository";

function parseNumberFeature(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getMonthRange(anchor: Date): { from: Date; toExclusive: Date } {
  const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 0, 0, 0, 0));
  const toExclusive = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );
  return { from, toExclusive };
}

export class SubscriptionGovernanceService {
  private readonly runtimeRepository = new RuntimeSubscriptionRepository();
  private readonly adminRepository = new AdminRepository();
  private readonly bookingRepository = new BookingRepository();
  private readonly currentSalonCount = 1;

  async getActiveLimits(tenantId: string): Promise<{
    planCode: string | null;
    maxSalons: number | null;
    maxStaff: number | null;
    maxBookingsPerMonth: number | null;
  }> {
    const planCode = await this.runtimeRepository.getActivePlanCode(tenantId, new Date());
    if (!planCode) {
      return {
        planCode: null,
        maxSalons: null,
        maxStaff: null,
        maxBookingsPerMonth: null
      };
    }

    const features = await this.runtimeRepository.getPlanFeatureMapByCode(planCode);
    return {
      planCode,
      maxSalons: parseNumberFeature(features.max_salons),
      maxStaff: parseNumberFeature(features.max_staff),
      maxBookingsPerMonth: parseNumberFeature(features.max_bookings_per_month)
    };
  }

  async enforceCanUseSalonCapacity(tenantId: string): Promise<void> {
    const planCode = await this.runtimeRepository.getActivePlanCode(tenantId, new Date());
    if (!planCode) {
      return;
    }
    const features = await this.runtimeRepository.getPlanFeatureMapByCode(planCode);
    const maxSalons = parseNumberFeature(features.max_salons);
    if (maxSalons === null || maxSalons <= 0) {
      return;
    }
    if (this.currentSalonCount > maxSalons) {
      throw appError("AUTH_FORBIDDEN", {
        reason: "subscription_limit_exceeded",
        featureKey: "max_salons",
        mode: "hard_block",
        limit: maxSalons,
        current: this.currentSalonCount,
        planCode
      });
    }
  }

  async enforceCanCreateMaster(tenantId: string): Promise<void> {
    await this.enforceCanUseSalonCapacity(tenantId);

    const planCode = await this.runtimeRepository.getActivePlanCode(tenantId, new Date());
    if (!planCode) {
      return;
    }

    const features = await this.runtimeRepository.getPlanFeatureMapByCode(planCode);
    const maxStaff = parseNumberFeature(features.max_staff);
    if (maxStaff === null || maxStaff <= 0) {
      return;
    }

    const current = await this.adminRepository.countActiveMastersByTenant(tenantId);
    if (current >= maxStaff) {
      throw appError("AUTH_FORBIDDEN", {
        reason: "subscription_limit_exceeded",
        featureKey: "max_staff",
        mode: "hard_block",
        limit: maxStaff,
        current,
        planCode
      });
    }
  }

  async enforceCanCreateBooking(tenantId: string, startAt: Date): Promise<void> {
    await this.enforceCanUseSalonCapacity(tenantId);

    const planCode = await this.runtimeRepository.getActivePlanCode(tenantId, new Date());
    if (!planCode) {
      return;
    }

    const features = await this.runtimeRepository.getPlanFeatureMapByCode(planCode);
    const maxBookings = parseNumberFeature(features.max_bookings_per_month);
    if (maxBookings === null || maxBookings <= 0) {
      return;
    }

    const range = getMonthRange(startAt);
    const current = await this.bookingRepository.countTenantBookingsInRange({
      tenantId,
      from: range.from,
      toExclusive: range.toExclusive
    });

    if (current >= maxBookings) {
      throw appError("AUTH_FORBIDDEN", {
        reason: "subscription_limit_exceeded",
        featureKey: "max_bookings_per_month",
        mode: "hard_block",
        limit: maxBookings,
        current,
        planCode,
        monthStart: range.from.toISOString()
      });
    }
  }
}
