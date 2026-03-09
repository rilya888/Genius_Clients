"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDateTime, t } from "@genius/i18n";
import { getBrowserLocale, parseLocaleCookie, setUiLocaleCookie } from "../../../lib/ui-locale";

type MasterItem = { id: string; displayName: string };
type ServiceItem = { id: string; displayName: string; durationMinutes: number };
type SlotItem = { masterId: string; startAt: string; endAt: string; displayTime: string };
type SlotDecision = {
  startMinute: number;
  endMinute: number;
  accepted: boolean;
  reason?: "blocked_range" | "busy_range" | "min_advance";
};
type SlotMasterDiagnostics = {
  masterId: string;
  candidateDecisions: SlotDecision[];
  firstSlotDisplayTime: string | null;
};
type SlotDiagnostics = {
  timezone: string;
  minAdvanceMinutes: number;
  bookingBufferMinutes: number;
  masters: SlotMasterDiagnostics[];
};

export default function PublicBookingPage() {
  const router = useRouter();
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
  const [slotHint, setSlotHint] = useState("");

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
    query.set("includeDiagnostics", "1");
    if (masterId) {
      query.set("masterId", masterId);
    }

    const response = await fetch(`/api/public/slots?${query.toString()}`);
    const payload = (await response.json()) as {
      data?: { items?: SlotItem[]; diagnostics?: SlotDiagnostics };
      error?: { message?: string };
    };
    if (!response.ok) {
      setStatus(payload?.error?.message ?? t("public.booking.loadSlotsFailed", { locale: clientLocale }));
      return;
    }

    setSlots(payload?.data?.items ?? []);
    setSelectedSlot(null);
    setStatus("");
    setSlotHint(buildSlotHint(payload?.data?.diagnostics, masterId));
  }

  function minuteToTime(value: number): string {
    const h = Math.floor(value / 60)
      .toString()
      .padStart(2, "0");
    const m = (value % 60).toString().padStart(2, "0");
    return `${h}:${m}`;
  }

  function reasonLabel(reason?: "blocked_range" | "busy_range" | "min_advance"): string {
    if (reason === "busy_range") {
      return "another booking already exists";
    }
    if (reason === "blocked_range") {
      return "blocked by schedule exception";
    }
    if (reason === "min_advance") {
      return "blocked by minimum advance time";
    }
    return "not available";
  }

  function buildSlotHint(diagnostics: SlotDiagnostics | undefined, selectedMasterId: string): string {
    if (!diagnostics || !selectedMasterId) {
      return "";
    }
    const masterDiagnostics = diagnostics.masters.find((item) => item.masterId === selectedMasterId);
    if (!masterDiagnostics || masterDiagnostics.candidateDecisions.length === 0) {
      return "";
    }

    const firstAccepted = masterDiagnostics.candidateDecisions.find((item) => item.accepted);
    const firstRejected = masterDiagnostics.candidateDecisions.find((item) => !item.accepted);
    if (!firstAccepted || !firstRejected) {
      return "";
    }

    if (firstRejected.startMinute < firstAccepted.startMinute) {
      return `First available slot is ${minuteToTime(firstAccepted.startMinute)} because ${minuteToTime(
        firstRejected.startMinute
      )} is unavailable: ${reasonLabel(firstRejected.reason)}.`;
    }

    return "";
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

    const params = new URLSearchParams();
    params.set("locale", clientLocale);
    if (payload?.data?.bookingId) {
      params.set("bookingId", String(payload.data.bookingId));
    }
    router.push(`/public/booking-success?${params.toString()}`);
  }

  const selectedMasterName = useMemo(() => {
    if (!selectedSlot) {
      return "";
    }
    return masters.find((item) => item.id === selectedSlot.masterId)?.displayName ?? selectedSlot.masterId;
  }, [masters, selectedSlot]);

  return (
    <main className="gc-book-page">
      <h1 className="gc-book-title">{t("public.booking.title", { locale: clientLocale })}</h1>
      <div className="gc-card gc-form-card">
        <div className="gc-book-grid-top">
          <select className="gc-select" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">{t("public.booking.selectService", { locale: clientLocale })}</option>
            {services.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName} ({item.durationMinutes}m)
              </option>
            ))}
          </select>
          <select className="gc-select" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
            <option value="">{t("public.booking.anyMaster", { locale: clientLocale })}</option>
            {masters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
          <input className="gc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="gc-action-btn" onClick={() => void loadSlots()}>
            {t("public.booking.findSlots", { locale: clientLocale })}
          </button>
        </div>

        <h3 className="gc-book-section-title">{t("public.booking.slots", { locale: clientLocale })}</h3>
        <div className="gc-slot-list">
          {slots.map((slot) => (
            <button
              className="gc-slot-btn"
              key={`${slot.masterId}-${slot.startAt}`}
              onClick={() => setSelectedSlot(slot)}
              aria-pressed={
                selectedSlot?.startAt === slot.startAt && selectedSlot.masterId === slot.masterId
              }
            >
              {slot.displayTime}
            </button>
          ))}
        </div>
        {slotHint ? <p className="gc-muted-line">{slotHint}</p> : null}

        <h3 className="gc-book-section-title">{t("public.booking.clientSection", { locale: clientLocale })}</h3>
        <div className="gc-book-grid-bottom">
          <input
            className="gc-input"
            placeholder={t("public.booking.namePlaceholder", { locale: clientLocale })}
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
          <input
            className="gc-input"
            placeholder={t("public.booking.phonePlaceholder", { locale: clientLocale })}
            value={clientPhoneE164}
            onChange={(e) => setClientPhoneE164(e.target.value)}
          />
          <input
            className="gc-input"
            placeholder={t("public.booking.emailPlaceholder", { locale: clientLocale })}
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
          />
          <select
            className="gc-select"
            value={clientLocale}
            onChange={(e) => setClientLocale(e.target.value as "it" | "en")}
          >
            <option value="it">it</option>
            <option value="en">en</option>
          </select>
          <button className="gc-action-btn" disabled={!canBook} onClick={() => void createBooking()}>
            {t("public.booking.bookAction", { locale: clientLocale })}
          </button>
        </div>

        <label className="gc-consent">
          <input
            type="checkbox"
            checked={clientConsent}
            onChange={(e) => setClientConsent(e.target.checked)}
          />
          {t("public.booking.consent", { locale: clientLocale })}
        </label>
        {!phoneValid && clientPhoneE164 ? (
          <p className="gc-error-text">{t("public.booking.phoneInvalid", { locale: clientLocale })}</p>
        ) : null}

        <p className="gc-muted-line">{status}</p>
        {selectedSlot ? (
          <p className="gc-selected-line">
            {t("public.booking.selected", {
              locale: clientLocale,
              params: {
                dateTime: formatDateTime(selectedSlot.startAt, { locale: clientLocale }),
                masterName: selectedMasterName
              }
            })}
          </p>
        ) : null}
      </div>
    </main>
  );
}
