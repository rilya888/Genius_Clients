import { appError } from "../lib/http";
import { SlotRepository } from "../repositories";

type GetAvailableSlotsInput = {
  tenantId: string;
  serviceId: string;
  date: string;
  masterId?: string;
  includeDiagnostics?: boolean;
};

type MinuteRange = {
  startMinute: number;
  endMinute: number;
};

type SlotDecisionReason = "blocked_range" | "busy_range" | "min_advance";

export type SlotCandidateDecision = {
  startMinute: number;
  endMinute: number;
  accepted: boolean;
  reason?: SlotDecisionReason;
};

export type SlotMasterDiagnostics = {
  masterId: string;
  workingWindows: Array<{ startMinute: number; endMinute: number }>;
  blockedRanges: Array<{ startMinute: number; endMinute: number }>;
  busyRanges: Array<{ startMinute: number; endMinute: number }>;
  candidateDecisions: SlotCandidateDecision[];
  producedSlots: number;
  firstSlotDisplayTime: string | null;
};

export type SlotDiagnostics = {
  timezone: string;
  minAdvanceMinutes: number;
  bookingBufferMinutes: number;
  masters: SlotMasterDiagnostics[];
};

type SlotItem = {
  masterId: string;
  startAt: string;
  endAt: string;
  displayTime: string;
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

  private parseDateParts(input: string): { year: number; month: number; day: number } {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    if (!match) {
      throw appError("VALIDATION_ERROR", { reason: "date_invalid", expected: "YYYY-MM-DD" });
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const canonical = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(canonical.getTime()) ||
      canonical.getUTCFullYear() !== year ||
      canonical.getUTCMonth() !== month - 1 ||
      canonical.getUTCDate() !== day
    ) {
      throw appError("VALIDATION_ERROR", { reason: "date_invalid", expected: "YYYY-MM-DD" });
    }
    return { year, month, day };
  }

  private getTimezoneOffsetMs(at: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(at);
    const timezoneName = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    const offsetMatch = /GMT([+-]\d{1,2})(?::?(\d{2}))?/.exec(timezoneName);
    if (!offsetMatch) {
      throw appError("INTERNAL_ERROR", { reason: "timezone_offset_parse_failed", timezone, timezoneName });
    }
    const hours = Number(offsetMatch[1]);
    const minutes = Number(offsetMatch[2] ?? "0");
    const sign = hours >= 0 ? 1 : -1;
    return sign * (Math.abs(hours) * 60 + minutes) * 60 * 1000;
  }

  private getUtcDateForTenantMidnight(
    dateParts: { year: number; month: number; day: number },
    timezone: string
  ): Date {
    const utcGuess = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 0, 0, 0, 0);
    const offsetMs = this.getTimezoneOffsetMs(new Date(utcGuess), timezone);
    return new Date(utcGuess - offsetMs);
  }

  async getAvailableSlots(input: GetAvailableSlotsInput): Promise<{
    items: SlotItem[];
    diagnostics?: SlotDiagnostics;
  }> {
    const tenant = await this.slotRepository.findTenantSettings(input.tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND");
    }

    const service = await this.slotRepository.findService(input.tenantId, input.serviceId);
    if (!service) {
      throw appError("VALIDATION_ERROR", { reason: "service_not_found" });
    }

    const dayParts = this.parseDateParts(input.date);
    const dayStartUtc = this.getUtcDateForTenantMidnight(dayParts, tenant.timezone);
    const nextDayDate = new Date(Date.UTC(dayParts.year, dayParts.month - 1, dayParts.day + 1));
    const dayEndUtc = this.getUtcDateForTenantMidnight(
      {
        year: nextDayDate.getUTCFullYear(),
        month: nextDayDate.getUTCMonth() + 1,
        day: nextDayDate.getUTCDate()
      },
      tenant.timezone
    );
    const dayOfWeek = new Date(Date.UTC(dayParts.year, dayParts.month - 1, dayParts.day)).getUTCDay();
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
      return {
        items: [],
        diagnostics: input.includeDiagnostics
          ? {
              timezone: tenant.timezone,
              minAdvanceMinutes: tenant.bookingMinAdvanceMinutes,
              bookingBufferMinutes: tenant.bookingBufferMinutes,
              masters: []
            }
          : undefined
      };
    }

    const masterIds = masterCandidates.map((m) => m.masterId);
    const [working, exceptions, busyBookings] = await Promise.all([
      this.slotRepository.listWorkingHoursForDay(input.tenantId, dayOfWeek, masterIds),
      this.slotRepository.listScheduleExceptionsForDate(input.tenantId, input.date, masterIds),
      this.slotRepository.listBusyBookings(input.tenantId, masterIds, dayStartUtc, dayEndUtc)
    ]);

    const minAllowedStart = new Date(now.getTime() + tenant.bookingMinAdvanceMinutes * 60 * 1000);
    const slots: SlotItem[] = [];
    const diagnosticsRows: SlotMasterDiagnostics[] = [];

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
          endMinute:
            Math.ceil((b.endAt.getTime() - dayStartUtc.getTime()) / 60000) + tenant.bookingBufferMinutes
        }));
      const slotStepMinutes = master.durationMinutesOverride ?? service.durationMinutes;
      const serviceDurationMinutes = master.durationMinutesOverride ?? service.durationMinutes;
      const diagnosticsRow: SlotMasterDiagnostics = {
        masterId: master.masterId,
        workingWindows: workingForMaster.map((window) => ({
          startMinute: window.startMinute,
          endMinute: window.endMinute
        })),
        blockedRanges: blockedRanges.map((range) => ({ ...range })),
        busyRanges: busyRanges.map((range) => ({ ...range })),
        candidateDecisions: [],
        producedSlots: 0,
        firstSlotDisplayTime: null
      };
      if (input.includeDiagnostics) {
        diagnosticsRows.push(diagnosticsRow);
      }

      for (const window of workingForMaster) {
        for (
          let startMinute = window.startMinute;
          startMinute + serviceDurationMinutes <= window.endMinute;
          startMinute += slotStepMinutes
        ) {
          const serviceEndMinute = startMinute + serviceDurationMinutes;
          const occupiedEndMinute = serviceEndMinute + tenant.bookingBufferMinutes;
          const candidateServiceRange = { startMinute, endMinute: serviceEndMinute };
          const candidateOccupiedRange = { startMinute, endMinute: occupiedEndMinute };
          const blockedConflict = blockedRanges.some((range) => this.overlaps(range, candidateServiceRange));
          if (blockedConflict) {
            if (input.includeDiagnostics) {
              diagnosticsRow.candidateDecisions.push({
                startMinute,
                endMinute: serviceEndMinute,
                accepted: false,
                reason: "blocked_range"
              });
            }
            continue;
          }
          const busyConflict = busyRanges.some((range) => this.overlaps(range, candidateOccupiedRange));
          if (busyConflict) {
            if (input.includeDiagnostics) {
              diagnosticsRow.candidateDecisions.push({
                startMinute,
                endMinute: serviceEndMinute,
                accepted: false,
                reason: "busy_range"
              });
            }
            continue;
          }

          const startAt = new Date(dayStartUtc.getTime() + startMinute * 60 * 1000);
          const endAt = new Date(dayStartUtc.getTime() + serviceEndMinute * 60 * 1000);
          if (startAt < minAllowedStart) {
            if (input.includeDiagnostics) {
              diagnosticsRow.candidateDecisions.push({
                startMinute,
                endMinute: serviceEndMinute,
                accepted: false,
                reason: "min_advance"
              });
            }
            continue;
          }

          slots.push({
            masterId: master.masterId,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            displayTime: this.formatTime(startAt, tenant.timezone)
          });
          if (input.includeDiagnostics) {
            diagnosticsRow.candidateDecisions.push({
              startMinute,
              endMinute: serviceEndMinute,
              accepted: true
            });
          }
        }
      }

      if (input.includeDiagnostics) {
        const producedForMaster = slots.filter((slot) => slot.masterId === master.masterId);
        diagnosticsRow.producedSlots = producedForMaster.length;
        diagnosticsRow.firstSlotDisplayTime = producedForMaster[0]?.displayTime ?? null;
      }
    }

    slots.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.masterId.localeCompare(b.masterId));
    return {
      items: slots,
      diagnostics: input.includeDiagnostics
        ? {
        timezone: tenant.timezone,
            minAdvanceMinutes: tenant.bookingMinAdvanceMinutes,
            bookingBufferMinutes: tenant.bookingBufferMinutes,
            masters: diagnosticsRows
          }
        : undefined
    };
  }
}
