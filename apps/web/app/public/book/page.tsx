"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDateTime, t } from "@genius/i18n";
import { getBrowserLocale, parseLocaleCookie, setUiLocaleCookie } from "../../../lib/ui-locale";
import { isUiV2Enabled } from "../../../lib/ui-flags";

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
type StatusTone = "neutral" | "error" | "success";

export default function PublicBookingPage() {
  const uiV2Enabled = isUiV2Enabled();
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
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [csrfToken, setCsrfToken] = useState("");
  const [slotHint, setSlotHint] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submittingBooking, setSubmittingBooking] = useState(false);

  const phoneValid = /^\+[1-9]\d{1,14}$/.test(clientPhoneE164.trim());
  const canBook =
    Boolean(serviceId && selectedSlot && clientName.trim() && phoneValid && clientConsent) &&
    Boolean(csrfToken);
  const progressSteps = [
    Boolean(serviceId),
    Boolean(date),
    Boolean(selectedSlot),
    Boolean(clientName.trim() && phoneValid),
    Boolean(clientConsent)
  ];
  const completedSteps = progressSteps.filter(Boolean).length;
  const progressPercent = Math.round((completedSteps / progressSteps.length) * 100);

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
      try {
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
          setStatusTone("error");
          return;
        }

        setMasters(mastersPayload?.data?.items ?? []);
        setServices(servicesPayload?.data?.items ?? []);
        setCsrfToken(csrfPayload?.data?.csrfToken ?? "");
        setStatus("");
        setStatusTone("neutral");
      } catch {
        setStatus(t("public.booking.loadCatalogFailed", { locale: clientLocale }));
        setStatusTone("error");
      }
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

    setLoadingSlots(true);
    try {
      const response = await fetch(`/api/public/slots?${query.toString()}`);
      const payload = (await response.json()) as {
        data?: { items?: SlotItem[]; diagnostics?: SlotDiagnostics };
        error?: { message?: string };
      };
      if (!response.ok) {
        setStatus(payload?.error?.message ?? t("public.booking.loadSlotsFailed", { locale: clientLocale }));
        setStatusTone("error");
        return;
      }

      const nextSlots = payload?.data?.items ?? [];
      setSlots(nextSlots);
      setSelectedSlot(null);
      setSlotHint(buildSlotHint(payload?.data?.diagnostics, masterId));
      setStatus("");
      setStatusTone("neutral");
    } catch {
      setStatus(t("public.booking.loadSlotsFailed", { locale: clientLocale }));
      setStatusTone("error");
    } finally {
      setLoadingSlots(false);
    }
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

    setSubmittingBooking(true);
    try {
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
        setStatusTone("error");
        return;
      }

      setStatus(
        t("public.booking.created", {
          locale: clientLocale,
          params: { bookingId: payload?.data?.bookingId ?? "ok" }
        })
      );
      setStatusTone("success");

      const params = new URLSearchParams();
      params.set("locale", clientLocale);
      if (payload?.data?.bookingId) {
        params.set("bookingId", String(payload.data.bookingId));
      }
      router.push(`/public/booking-success?${params.toString()}`);
    } catch {
      setStatus(t("public.booking.createFailed", { locale: clientLocale }));
      setStatusTone("error");
    } finally {
      setSubmittingBooking(false);
    }
  }

  const selectedMasterName = useMemo(() => {
    if (!selectedSlot) {
      return "";
    }
    return masters.find((item) => item.id === selectedSlot.masterId)?.displayName ?? selectedSlot.masterId;
  }, [masters, selectedSlot]);
  const selectedServiceName = useMemo(() => {
    if (!serviceId) {
      return "Not selected";
    }
    return services.find((item) => item.id === serviceId)?.displayName ?? serviceId;
  }, [serviceId, services]);

  const bookingForm = (
    <div className="gc-card gc-form-card gc-book-form-main">
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
          <button className="gc-action-btn" onClick={() => void loadSlots()} disabled={loadingSlots}>
            {loadingSlots ? "Loading..." : t("public.booking.findSlots", { locale: clientLocale })}
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
          {!loadingSlots && slots.length === 0 ? (
            <p className="gc-slot-empty">No available slots for the selected criteria yet.</p>
          ) : null}
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
          <button
            className="gc-action-btn"
            disabled={!canBook || submittingBooking}
            onClick={() => void createBooking()}
          >
            {submittingBooking ? "Submitting..." : t("public.booking.bookAction", { locale: clientLocale })}
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

        <p className={`gc-muted-line gc-status-${statusTone}`} role="status" aria-live="polite">{status}</p>
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
  );

  return (
    <main className={`gc-book-page${uiV2Enabled ? " gc-book-page-v2" : ""}`}>
      <h1 className="gc-book-title">{t("public.booking.title", { locale: clientLocale })}</h1>
      {uiV2Enabled ? (
        <p className="gc-book-subtitle gc-v2-fade-up">
          Select service, specialist, and preferred slot, then confirm your contact details.
        </p>
      ) : null}
      {uiV2Enabled ? (
        <div className="gc-book-layout">
          <aside className="gc-book-summary-stack">
          <div className="gc-card gc-book-summary gc-v2-fade-up">
            <h2 className="gc-book-summary-title">Booking progress</h2>
            <div className="gc-book-progress-row">
              <span>{completedSteps}/{progressSteps.length} completed</span>
              <strong>{progressPercent}%</strong>
            </div>
            <div className="gc-book-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <ul className="gc-book-summary-list">
              <li data-done={serviceId ? "true" : "false"}>Service selected</li>
              <li data-done={date ? "true" : "false"}>Date selected</li>
              <li data-done={selectedSlot ? "true" : "false"}>Slot selected</li>
              <li data-done={clientName.trim() && phoneValid ? "true" : "false"}>Contact details filled</li>
              <li data-done={clientConsent ? "true" : "false"}>Consent accepted</li>
            </ul>
            <div className="gc-book-summary-facts">
              <div>
                <span>Service</span>
                <strong>{selectedServiceName}</strong>
              </div>
              <div>
                <span>Specialist</span>
                <strong>{selectedSlot ? selectedMasterName : "Not selected"}</strong>
              </div>
              <div>
                <span>Slot</span>
                <strong>{selectedSlot ? selectedSlot.displayTime : "Not selected"}</strong>
              </div>
            </div>
          </div>
          <div className="gc-card gc-book-summary-note gc-v2-fade-up gc-v2-fade-up-delay-1">
            <h3 className="gc-feature-title">Booking policy</h3>
            <p className="gc-feature-text">
              Slots are validated in real time and protected with idempotent booking creation.
            </p>
            <ul className="gc-book-policy-list">
              <li>Live slot validation with schedule constraints</li>
              <li>Secure booking submit with CSRF + idempotency key</li>
              <li>Locale-aware confirmation response</li>
            </ul>
          </div>
          </aside>
          <div className="gc-v2-fade-up gc-v2-fade-up-delay-1">{bookingForm}</div>
        </div>
      ) : (
        bookingForm
      )}
    </main>
  );
}
