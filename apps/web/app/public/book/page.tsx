"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDateTime, t } from "@genius/i18n";
import { getBrowserLocale, parseLocaleCookie, setUiLocaleCookie } from "../../../lib/ui-locale";

type MasterItem = { id: string; displayName: string };
type ServiceItem = { id: string; displayName: string; durationMinutes: number };
type SlotItem = { masterId: string; startAt: string; endAt: string; displayTime: string };

export default function PublicBookingPage() {
  const searchParams = useSearchParams();
  const [masters, setMasters] = useState<MasterItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [masterId, setMasterId] = useState("");
  const [date, setDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhoneE164, setClientPhoneE164] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientLocale, setClientLocale] = useState<"it" | "en">("it");
  const [clientConsent, setClientConsent] = useState(false);
  const [status, setStatus] = useState("");
  const [csrfToken, setCsrfToken] = useState("");

  const phoneValid = /^\+[1-9]\d{1,14}$/.test(clientPhoneE164.trim());
  const canBook =
    Boolean(serviceId && selectedSlot && clientName.trim() && phoneValid && clientConsent) &&
    Boolean(csrfToken);

  useEffect(() => {
    const requestedFromQuery = searchParams.get("locale");
    const requestedFromCookie = parseLocaleCookie(document.cookie);
    if (requestedFromQuery === "it" || requestedFromQuery === "en") {
      setClientLocale(requestedFromQuery);
      return;
    }
    if (requestedFromCookie) {
      setClientLocale(requestedFromCookie);
      return;
    }
    setClientLocale(getBrowserLocale());
  }, [searchParams]);

  useEffect(() => {
    setUiLocaleCookie(clientLocale);
  }, [clientLocale]);

  useEffect(() => {
    async function bootstrap() {
      const [mastersRes, servicesRes, csrfRes] = await Promise.all([
        fetch(`/api/public/masters?locale=${encodeURIComponent(clientLocale)}`),
        fetch(`/api/public/services?locale=${encodeURIComponent(clientLocale)}`),
        fetch("/api/csrf")
      ]);
      const mastersPayload = await mastersRes.json();
      const servicesPayload = await servicesRes.json();
      const csrfPayload = await csrfRes.json();

      if (!mastersRes.ok || !servicesRes.ok) {
        setStatus(t("public.booking.loadCatalogFailed", { locale: clientLocale }));
        return;
      }

      setMasters(mastersPayload?.data?.items ?? []);
      setServices(servicesPayload?.data?.items ?? []);
      setCsrfToken(csrfPayload?.data?.csrfToken ?? "");
    }

    void bootstrap();
  }, [clientLocale]);

  async function loadSlots() {
    if (!serviceId || !date) {
      return;
    }

    const query = new URLSearchParams();
    query.set("serviceId", serviceId);
    query.set("date", date);
    if (masterId) {
      query.set("masterId", masterId);
    }

    const response = await fetch(`/api/public/slots?${query.toString()}`);
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload?.error?.message ?? t("public.booking.loadSlotsFailed", { locale: clientLocale }));
      return;
    }

    setSlots(payload?.data?.items ?? []);
    setSelectedSlot(null);
    setStatus("");
  }

  async function createBooking() {
    if (!canBook || !serviceId || !selectedSlot) {
      return;
    }

    const idempotencyKey = crypto.randomUUID();
    const response = await fetch("/api/public/bookings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        serviceId,
        masterId: selectedSlot.masterId,
        source: "web",
        clientName: clientName.trim(),
        clientPhoneE164: clientPhoneE164.trim(),
        clientEmail: clientEmail || undefined,
        clientLocale,
        clientConsent,
        startAt: selectedSlot.startAt,
        endAt: selectedSlot.endAt
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload?.error?.message ?? t("public.booking.createFailed", { locale: clientLocale }));
      return;
    }

    setStatus(
      t("public.booking.created", {
        locale: clientLocale,
        params: { bookingId: payload?.data?.bookingId ?? "ok" }
      })
    );
  }

  const selectedMasterName = useMemo(() => {
    if (!selectedSlot) {
      return "";
    }
    return masters.find((item) => item.id === selectedSlot.masterId)?.displayName ?? selectedSlot.masterId;
  }, [masters, selectedSlot]);

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>{t("public.booking.title", { locale: clientLocale })}</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 160px auto", gap: 8 }}>
        <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">{t("public.booking.selectService", { locale: clientLocale })}</option>
          {services.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName} ({item.durationMinutes}m)
            </option>
          ))}
        </select>
        <select value={masterId} onChange={(e) => setMasterId(e.target.value)}>
          <option value="">{t("public.booking.anyMaster", { locale: clientLocale })}</option>
          {masters.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={() => void loadSlots()}>
          {t("public.booking.findSlots", { locale: clientLocale })}
        </button>
      </div>

      <h3>{t("public.booking.slots", { locale: clientLocale })}</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", minHeight: 44 }}>
        {slots.map((slot) => (
          <button
            key={`${slot.masterId}-${slot.startAt}`}
            onClick={() => setSelectedSlot(slot)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              background:
                selectedSlot?.startAt === slot.startAt && selectedSlot.masterId === slot.masterId
                  ? "#dbeafe"
                  : "#fff"
            }}
          >
            {slot.displayTime}
          </button>
        ))}
      </div>

      <h3>{t("public.booking.clientSection", { locale: clientLocale })}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 90px auto", gap: 8 }}>
        <input
          placeholder={t("public.booking.namePlaceholder", { locale: clientLocale })}
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
        />
        <input
          placeholder={t("public.booking.phonePlaceholder", { locale: clientLocale })}
          value={clientPhoneE164}
          onChange={(e) => setClientPhoneE164(e.target.value)}
        />
        <input
          placeholder={t("public.booking.emailPlaceholder", { locale: clientLocale })}
          value={clientEmail}
          onChange={(e) => setClientEmail(e.target.value)}
        />
        <select value={clientLocale} onChange={(e) => setClientLocale(e.target.value as "it" | "en")}>
          <option value="it">it</option>
          <option value="en">en</option>
        </select>
        <button disabled={!canBook} onClick={() => void createBooking()}>
          {t("public.booking.bookAction", { locale: clientLocale })}
        </button>
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <input
          type="checkbox"
          checked={clientConsent}
          onChange={(e) => setClientConsent(e.target.checked)}
        />
        {t("public.booking.consent", { locale: clientLocale })}
      </label>
      {!phoneValid && clientPhoneE164 ? (
        <p style={{ color: "#b91c1c", marginTop: 6 }}>
          {t("public.booking.phoneInvalid", { locale: clientLocale })}
        </p>
      ) : null}

      <p style={{ color: "#4b5563", minHeight: 20 }}>{status}</p>
      {selectedSlot ? (
        <p style={{ color: "#1f2937" }}>
          {t("public.booking.selected", {
            locale: clientLocale,
            params: {
              dateTime: formatDateTime(selectedSlot.startAt, { locale: clientLocale }),
              masterName: selectedMasterName
            }
          })}
        </p>
      ) : null}
    </main>
  );
}
