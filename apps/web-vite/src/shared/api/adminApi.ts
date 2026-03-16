import { httpJson } from "./http";

type ServicesEnvelope = {
  data: {
    items: Array<{
      id: string;
      displayName: string;
      durationMinutes: number;
      priceCents: number | null;
      isActive: boolean;
    }>;
  };
};

type BookingsEnvelope = {
  data: {
    items: Array<{
      id: string;
      serviceId: string;
      masterId: string | null;
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

function authHeaders() {
  const accessToken = localStorage.getItem("access_token");
  const headers = new Headers();
  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }
  return headers;
}

export async function listAdminServices() {
  const payload = await httpJson<ServicesEnvelope>("/api/v1/admin/services", {
    method: "GET",
    headers: authHeaders()
  });
  return payload.data.items;
}

export async function listAdminBookings(input?: {
  status?: "pending" | "confirmed" | "completed" | "cancelled";
  from?: string;
  to?: string;
}) {
  const payload = await httpJson<BookingsEnvelope>("/api/v1/admin/bookings", {
    method: "GET",
    query: {
      limit: 50,
      status: input?.status,
      from: input?.from,
      to: input?.to
    },
    headers: authHeaders()
  });
  return payload.data.items;
}

export async function getNotificationSummary() {
  const payload = await httpJson<NotificationSummaryEnvelope>("/api/v1/admin/notification-deliveries/summary", {
    method: "GET",
    headers: authHeaders()
  });
  return payload.data;
}

export async function listNotificationDeliveries() {
  const payload = await httpJson<DeliveriesEnvelope>("/api/v1/admin/notification-deliveries", {
    method: "GET",
    headers: authHeaders()
  });
  return payload.data.items;
}

export async function listAdminMasters() {
  const payload = await httpJson<MastersEnvelope>("/api/v1/admin/masters", {
    method: "GET",
    headers: authHeaders()
  });
  return payload.data.items;
}

export async function listWorkingHours() {
  const payload = await httpJson<WorkingHoursEnvelope>("/api/v1/admin/working-hours", {
    method: "GET",
    headers: authHeaders()
  });
  return payload.data.items;
}

export async function listScheduleExceptions() {
  const payload = await httpJson<ExceptionsEnvelope>("/api/v1/admin/exceptions", {
    method: "GET",
    headers: authHeaders()
  });
  return payload.data.items;
}

export async function retryFailedNotifications() {
  const payload = await httpJson<RetryEnvelope>("/api/v1/admin/notification-deliveries/retry-failed", {
    method: "POST",
    body: JSON.stringify({ limit: 50 }),
    headers: authHeaders()
  });
  return payload.data;
}

export async function anonymizeBookings(input: { phoneE164: string; beforeDate?: string }) {
  const payload = await httpJson<AnonymizeEnvelope>("/api/v1/admin/privacy/anonymize-bookings", {
    method: "POST",
    body: JSON.stringify(input),
    headers: authHeaders()
  });
  return payload.data;
}

export async function getTenantSettings() {
  const payload = await httpJson<TenantSettingsEnvelope>("/api/v1/admin/tenant-settings", {
    method: "GET",
    headers: authHeaders()
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
  await httpJson<TenantSettingsEnvelope>("/api/v1/admin/tenant-settings", {
    method: "PATCH",
    body: JSON.stringify({ faqContent: input }),
    headers: authHeaders()
  });
}
