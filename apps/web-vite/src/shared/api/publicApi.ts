import { httpJson } from "./http";

export type PublicTenantProfile = {
  id: string;
  slug: string;
  name: string;
  defaultLocale: "en" | "it";
  timezone: string;
  botConfig: {
    openaiEnabled: boolean;
    openaiModel: string | null;
    humanHandoffEnabled: boolean;
    adminNotificationWhatsappE164: string | null;
  };
};

export type PublicService = {
  id: string;
  displayName: string;
  durationMinutes: number;
  priceCents: number | null;
};

export type PublicMaster = {
  id: string;
  displayName: string;
};

export type PublicSlot = {
  masterId: string;
  startAt: string;
  endAt: string;
};

type ListEnvelope<T> = {
  data: {
    items: T[];
  };
};

export async function getPublicTenantProfile(slug: string) {
  const payload = await httpJson<{
    data: PublicTenantProfile;
  }>(`/api/v1/public/tenants/${slug}`, {
    method: "GET"
  });
  return payload.data;
}

export async function listPublicServices(locale: "en" | "it") {
  const payload = await httpJson<ListEnvelope<PublicService>>("/api/v1/public/services", {
    method: "GET",
    query: { locale }
  });
  return payload.data.items;
}

export async function listPublicMasters(locale: "en" | "it", serviceId?: string) {
  const payload = await httpJson<ListEnvelope<PublicMaster>>("/api/v1/public/masters", {
    method: "GET",
    query: { locale, serviceId }
  });
  return payload.data.items;
}

export async function listPublicSlots(input: {
  serviceId: string;
  date: string;
  masterId?: string;
}) {
  const payload = await httpJson<ListEnvelope<PublicSlot>>("/api/v1/public/slots", {
    method: "GET",
    query: {
      serviceId: input.serviceId,
      date: input.date,
      masterId: input.masterId
    }
  });
  return payload.data.items;
}

export async function createPublicBooking(input: {
  serviceId: string;
  masterId?: string;
  clientName: string;
  clientPhoneE164: string;
  clientEmail?: string;
  clientLocale: "en" | "it";
  startAt: string;
  endAt: string;
}) {
  const payload = await httpJson<{
    data: {
      bookingId: string;
      status: string;
    };
  }>("/api/v1/public/bookings", {
    method: "POST",
    headers: {
      "idempotency-key": crypto.randomUUID()
    },
    body: JSON.stringify({
      serviceId: input.serviceId,
      masterId: input.masterId,
      source: "web_public",
      clientName: input.clientName,
      clientPhoneE164: input.clientPhoneE164,
      clientEmail: input.clientEmail,
      clientLocale: input.clientLocale,
      clientConsent: true,
      startAt: input.startAt,
      endAt: input.endAt
    })
  });
  return {
    id: payload.data.bookingId,
    status: payload.data.status
  };
}
