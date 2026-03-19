import { clearSession, ensureAccessToken, forceRefreshAccessToken } from "../auth/session";
import { ApiHttpError, httpJson } from "./http";

type ServicesEnvelope = {
  data: {
    items: Array<{
      id: string;
      displayName: string;
      durationMinutes: number;
      priceCents: number | null;
      sortOrder: number;
      isActive: boolean;
    }>;
  };
};

type BookingsEnvelope = {
  data: {
    items: Array<{
      id: string;
      serviceId: string;
      serviceDisplayName: string;
      masterId: string | null;
      masterDisplayName: string | null;
      clientName: string;
      status: "pending" | "confirmed" | "completed" | "cancelled";
      startAt: string;
    }>;
  };
};

type NotificationSummaryEnvelope = {
  data: {
    total: number;
    queued: number;
    sent: number;
    failed: number;
    deadLetter: number;
  };
};

type TenantSettingsEnvelope = {
  data: {
    faqContent?: {
      it?: {
        priceInfo?: string;
        addressInfo?: string;
        parkingInfo?: string;
        workingHoursInfo?: string;
      };
      en?: {
        priceInfo?: string;
        addressInfo?: string;
        parkingInfo?: string;
        workingHoursInfo?: string;
      };
    };
  };
};

type DeliveriesEnvelope = {
  data: {
    items: Array<{
      id: string;
      notificationType: string;
      status: string;
      channel: string;
      createdAt: string;
    }>;
  };
};

type MastersEnvelope = {
  data: {
    items: Array<{
      id: string;
      displayName: string;
      isActive: boolean;
    }>;
  };
};

type WorkingHoursEnvelope = {
  data: {
    items: Array<{
      id: string;
      masterId: string | null;
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
      isActive: boolean;
    }>;
  };
};

type ExceptionsEnvelope = {
  data: {
    items: Array<{
      id: string;
      masterId: string | null;
      date: string;
      isClosed: boolean;
      startMinute: number | null;
      endMinute: number | null;
      note: string | null;
    }>;
  };
};

type RetryEnvelope = {
  data: {
    queued: number;
  };
};

type AnonymizeEnvelope = {
  data: {
    affected: number;
  };
};

type ScopeEnvelope = {
  data: {
    account: {
      id: string;
      slug: string;
      name: string;
    };
    salons: Array<{
      id: string;
      accountId: string;
      name: string;
      isPrimary: boolean;
    }>;
    capabilities: {
      multiSalon: boolean;
    };
  };
};

async function authHeaders(existing?: HeadersInit) {
  const headers = new Headers(existing);
  const accessToken = await ensureAccessToken();
  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }
  return headers;
}

async function adminJson<T>(path: string, init: Parameters<typeof httpJson>[1]) {
  try {
    return await httpJson<T>(path, { ...init, headers: await authHeaders(init?.headers) });
  } catch (error) {
    if (!(error instanceof ApiHttpError) || error.status !== 401) {
      throw error;
    }
  }

  const refreshedToken = await forceRefreshAccessToken();
  if (!refreshedToken) {
    clearSession();
    if (typeof window !== "undefined") {
      window.location.replace("/login");
    }
    throw new ApiHttpError({ status: 401, requestId: null, message: "HTTP_401", code: null });
  }

  try {
    return await httpJson<T>(path, { ...init, headers: await authHeaders(init?.headers) });
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 401) {
      clearSession();
      if (typeof window !== "undefined") {
        window.location.replace("/login");
      }
    }
    throw error;
  }
}

export async function listAdminServices() {
  const payload = await adminJson<ServicesEnvelope>("/api/v1/admin/services", {
    method: "GET"
  });
  return payload.data.items;
}

export async function createAdminService(input: {
  displayName: string;
  durationMinutes: number;
  priceCents?: number | null;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const payload = await adminJson<{
    data: {
      id: string;
      displayName: string;
      durationMinutes: number;
      priceCents: number | null;
      isActive: boolean;
    };
  }>("/api/v1/admin/services", {
    method: "POST",
    body: JSON.stringify({
      displayName: input.displayName,
      durationMinutes: input.durationMinutes,
      priceCents: input.priceCents ?? undefined,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true
    })
  });

  return payload.data;
}

export async function updateAdminService(input: {
  id: string;
  displayName: string;
  durationMinutes: number;
  priceCents?: number | null;
  sortOrder: number;
  isActive: boolean;
}) {
  const payload = await adminJson<{
    data: {
      id: string;
      displayName: string;
      durationMinutes: number;
      priceCents: number | null;
      isActive: boolean;
    };
  }>(`/api/v1/admin/services/${input.id}`, {
    method: "PUT",
    body: JSON.stringify({
      displayName: input.displayName,
      durationMinutes: input.durationMinutes,
      priceCents: input.priceCents ?? null,
      sortOrder: input.sortOrder,
      isActive: input.isActive
    })
  });

  return payload.data;
}

export async function deleteAdminService(serviceId: string) {
  const payload = await adminJson<{
    data: {
      id: string;
      isActive: boolean;
    };
  }>(`/api/v1/admin/services/${serviceId}`, {
    method: "DELETE"
  });

  return payload.data;
}

export async function listAdminBookings(input?: {
  status?: "pending" | "confirmed" | "completed" | "cancelled";
  from?: string;
  to?: string;
}) {
  const payload = await adminJson<BookingsEnvelope>("/api/v1/admin/bookings", {
    method: "GET",
    query: {
      limit: 50,
      status: input?.status,
      from: input?.from,
      to: input?.to
    }
  });
  return payload.data.items;
}

export async function confirmAdminBooking(bookingId: string) {
  const payload = await adminJson<{
    data: {
      id: string;
      status: "pending" | "confirmed" | "completed" | "cancelled";
      updatedAt: string;
    };
  }>(`/api/v1/admin/bookings/${bookingId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "confirmed" })
  });

  return payload.data;
}

export async function getNotificationSummary() {
  const payload = await adminJson<NotificationSummaryEnvelope>("/api/v1/admin/notification-deliveries/summary", {
    method: "GET"
  });
  return payload.data;
}

export async function listNotificationDeliveries() {
  const payload = await adminJson<DeliveriesEnvelope>("/api/v1/admin/notification-deliveries", {
    method: "GET"
  });
  return payload.data.items;
}

export async function listAdminMasters() {
  const payload = await adminJson<MastersEnvelope>("/api/v1/admin/masters", {
    method: "GET"
  });
  return payload.data.items;
}

export async function createAdminMaster(input: { displayName: string; isActive?: boolean }) {
  const payload = await adminJson<{
    data: {
      id: string;
      displayName: string;
      isActive: boolean;
    };
  }>("/api/v1/admin/masters", {
    method: "POST",
    body: JSON.stringify({
      displayName: input.displayName,
      isActive: input.isActive ?? true
    })
  });

  return payload.data;
}

export async function updateAdminMaster(input: {
  id: string;
  displayName: string;
  isActive: boolean;
  forceDeactivate?: boolean;
}) {
  const payload = await adminJson<{
    data: {
      id: string;
      displayName: string;
      isActive: boolean;
    };
  }>(`/api/v1/admin/masters/${input.id}`, {
    method: "PUT",
    body: JSON.stringify({
      displayName: input.displayName,
      isActive: input.isActive,
      forceDeactivate: input.forceDeactivate
    })
  });

  return payload.data;
}

export async function getAdminMasterDeactivationCheck(masterId: string) {
  const payload = await adminJson<{
    data: {
      upcomingConfirmedCount: number;
      earliestStartAt: string | null;
    };
  }>(`/api/v1/admin/masters/${masterId}/deactivation-check`, {
    method: "GET"
  });

  return payload.data;
}

export async function deleteAdminMaster(masterId: string) {
  const payload = await adminJson<{
    data: {
      id: string;
      isActive: boolean;
    };
  }>(`/api/v1/admin/masters/${masterId}`, {
    method: "DELETE"
  });

  return payload.data;
}

export async function listWorkingHours() {
  const payload = await adminJson<WorkingHoursEnvelope>("/api/v1/admin/working-hours", {
    method: "GET"
  });
  return payload.data.items;
}

export async function createWorkingHoursEntry(input: {
  masterId?: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive?: boolean;
}) {
  const payload = await adminJson<{
    data: {
      id: string;
      masterId: string | null;
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
      isActive: boolean;
    };
  }>("/api/v1/admin/working-hours", {
    method: "POST",
    body: JSON.stringify(input)
  });

  return payload.data;
}

export async function updateWorkingHoursEntry(input: {
  id: string;
  masterId?: string | null;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
}) {
  const payload = await adminJson<{
    data: {
      id: string;
      masterId: string | null;
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
      isActive: boolean;
    };
  }>(`/api/v1/admin/working-hours/${input.id}`, {
    method: "PUT",
    body: JSON.stringify({
      masterId: input.masterId ?? null,
      dayOfWeek: input.dayOfWeek,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      isActive: input.isActive
    })
  });

  return payload.data;
}

export async function deleteWorkingHoursEntry(id: string) {
  await adminJson<{ data: { id: string } }>(`/api/v1/admin/working-hours/${id}`, {
    method: "DELETE"
  });
}

export async function listScheduleExceptions() {
  const payload = await adminJson<ExceptionsEnvelope>("/api/v1/admin/exceptions", {
    method: "GET"
  });
  return payload.data.items;
}

export async function retryFailedNotifications() {
  const payload = await adminJson<RetryEnvelope>("/api/v1/admin/notification-deliveries/retry-failed", {
    method: "POST",
    body: JSON.stringify({ limit: 50 })
  });
  return payload.data;
}

export async function anonymizeBookings(input: { phoneE164: string; beforeDate?: string }) {
  const payload = await adminJson<AnonymizeEnvelope>("/api/v1/admin/privacy/anonymize-bookings", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.data;
}

export async function getTenantSettings() {
  const payload = await adminJson<TenantSettingsEnvelope>("/api/v1/admin/tenant-settings", {
    method: "GET"
  });
  return payload.data;
}

export async function getAdminScope() {
  const payload = await adminJson<ScopeEnvelope>("/api/v1/admin/scope", {
    method: "GET"
  });
  return payload.data;
}

export async function updateTenantFaqContent(input: {
  it: {
    priceInfo: string;
    addressInfo: string;
    parkingInfo: string;
    workingHoursInfo: string;
  };
  en: {
    priceInfo: string;
    addressInfo: string;
    parkingInfo: string;
    workingHoursInfo: string;
  };
}) {
  await adminJson<TenantSettingsEnvelope>("/api/v1/admin/tenant-settings", {
    method: "PATCH",
    body: JSON.stringify({ faqContent: input })
  });
}
