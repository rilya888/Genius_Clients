import { appError } from "../lib/http";
import { SlotRepository } from "../repositories";

type GetAvailableSlotsInput = {
  tenantId: string;
  serviceId: string;
  date: string;
  masterId?: string;
};

type MinuteRange = {
  startMinute: number;
  endMinute: number;
};

export class SlotService {
  private readonly slotRepository = new SlotRepository();

  private overlaps(a: MinuteRange, b: MinuteRange): boolean {
    return a.startMinute < b.endMinute && a.endMinute > b.startMinute;
  }

  private formatTime(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone
    }).format(date);
  }

  private parseDate(input: string): Date {
    const parsed = new Date(`${input}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw appError("VALIDATION_ERROR", { reason: "date_invalid", expected: "YYYY-MM-DD" });
    }
    return parsed;
  }

  async getAvailableSlots(input: GetAvailableSlotsInput) {
    const tenant = await this.slotRepository.findTenantSettings(input.tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND");
    }

    const service = await this.slotRepository.findService(input.tenantId, input.serviceId);
    if (!service) {
      throw appError("VALIDATION_ERROR", { reason: "service_not_found" });
    }

    const dayStartUtc = this.parseDate(input.date);
    const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);
    const dayOfWeek = dayStartUtc.getUTCDay();
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + tenant.bookingHorizonDays * 24 * 60 * 60 * 1000);

    if (dayStartUtc > horizonEnd) {
      throw appError("VALIDATION_ERROR", { reason: "date_exceeds_booking_horizon" });
    }

    const masterCandidates = await this.slotRepository.listMasterCandidates(
      input.tenantId,
      input.serviceId,
      input.masterId
    );
    if (masterCandidates.length === 0) {
      return [];
    }

    const masterIds = masterCandidates.map((m) => m.masterId);
    const [working, exceptions, busyBookings] = await Promise.all([
      this.slotRepository.listWorkingHoursForDay(input.tenantId, dayOfWeek, masterIds),
      this.slotRepository.listScheduleExceptionsForDate(input.tenantId, input.date, masterIds),
      this.slotRepository.listBusyBookings(input.tenantId, masterIds, dayStartUtc, dayEndUtc)
    ]);

    const minAllowedStart = new Date(now.getTime() + tenant.bookingMinAdvanceMinutes * 60 * 1000);
    const slots: Array<{
      masterId: string;
      startAt: string;
      endAt: string;
      displayTime: string;
    }> = [];

    for (const master of masterCandidates) {
      const workingForMaster = working.filter((item) => item.masterId === null || item.masterId === master.masterId);
      const exceptionForMaster = exceptions.filter(
        (item) => item.masterId === null || item.masterId === master.masterId
      );
      const hasDayClosedException = exceptionForMaster.some((item) => item.isClosed);
      if (hasDayClosedException) {
        continue;
      }

      const blockedRanges: MinuteRange[] = exceptionForMaster
        .filter((item) => item.startMinute !== null && item.endMinute !== null)
        .map((item) => ({ startMinute: item.startMinute as number, endMinute: item.endMinute as number }));
      const busyRanges: MinuteRange[] = busyBookings
        .filter((b) => b.masterId === master.masterId)
        .map((b) => ({
          startMinute: Math.floor((b.startAt.getTime() - dayStartUtc.getTime()) / 60000),
          endMinute: Math.ceil((b.endAt.getTime() - dayStartUtc.getTime()) / 60000)
        }));
      const slotStepMinutes = master.durationMinutesOverride ?? service.durationMinutes;
      const totalDuration =
        (master.durationMinutesOverride ?? service.durationMinutes) + tenant.bookingBufferMinutes;

      for (const window of workingForMaster) {
        for (
          let startMinute = window.startMinute;
          startMinute + totalDuration <= window.endMinute;
          startMinute += slotStepMinutes
        ) {
          const endMinute = startMinute + totalDuration;
          const candidateRange = { startMinute, endMinute };
          if (
            blockedRanges.some((range) => this.overlaps(range, candidateRange)) ||
            busyRanges.some((range) => this.overlaps(range, candidateRange))
          ) {
            continue;
          }

          const startAt = new Date(dayStartUtc.getTime() + startMinute * 60 * 1000);
          const endAt = new Date(dayStartUtc.getTime() + endMinute * 60 * 1000);
          if (startAt < minAllowedStart) {
            continue;
          }

          slots.push({
            masterId: master.masterId,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            displayTime: this.formatTime(startAt, tenant.timezone)
          });
        }
      }
    }

    slots.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.masterId.localeCompare(b.masterId));
    return slots;
  }
}
