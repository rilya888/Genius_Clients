import { useEffect, useMemo, useState } from "react";
import {
  createPublicBooking,
  listPublicMasters,
  listPublicServices,
  listPublicSlots,
  type PublicSlot
} from "../shared/api/publicApi";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { useI18n } from "../shared/i18n/I18nProvider";
import { resolveBrowserTenantContext } from "../shared/routing/tenant-host";

type LoadState<T> = {
  pending: boolean;
  error: string | null;
  data: T;
};

function slotLabel(slot: PublicSlot, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(slot.startAt));
}

export function PublicBookingPage({ embedded = false }: { embedded?: boolean }) {
  const { locale, t } = useI18n();
  const tenantContext = resolveBrowserTenantContext();
  const hasTenantContext = tenantContext.slug !== null;
  const [services, setServices] = useState<LoadState<{ id: string; displayName: string }[]>>({
    pending: true,
    error: null,
    data: []
  });
  const [masters, setMasters] = useState<LoadState<{ id: string; displayName: string }[]>>({
    pending: false,
    error: null,
    data: []
  });
  const [slots, setSlots] = useState<LoadState<PublicSlot[]>>({
    pending: false,
    error: null,
    data: []
  });

  const [serviceId, setServiceId] = useState("");
  const [masterId, setMasterId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);
  const [bookingPending, setBookingPending] = useState(false);
  const [bookingMessage, setBookingMessage] = useState<string | null>(null);
  const [bookingCreated, setBookingCreated] = useState(false);
  const [bookingHasError, setBookingHasError] = useState(false);

  useEffect(() => {
    if (!hasTenantContext) {
      setServices({ pending: false, error: null, data: [] });
      return;
    }

    let cancelled = false;
    setServices({ pending: true, error: null, data: [] });

    listPublicServices(locale)
      .then((items) => {
        if (cancelled) {
          return;
        }
        const minimal = items.map((item) => ({ id: item.id, displayName: item.displayName }));
        setServices({ pending: false, error: null, data: minimal });
        const firstService = minimal[0];
        if (firstService) {
          setServiceId((prev) => prev || firstService.id);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setServices({ pending: false, error: t("public.booking.loadCatalogFailed"), data: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasTenantContext, locale, t]);

  useEffect(() => {
    if (!hasTenantContext || !serviceId) {
      setMasters({ pending: false, error: null, data: [] });
      return;
    }

    let cancelled = false;
    setMasters((state) => ({ ...state, pending: true, error: null }));

    listPublicMasters(locale, serviceId)
      .then((items) => {
        if (cancelled) {
          return;
        }
        const minimal = items.map((item) => ({ id: item.id, displayName: item.displayName }));
        setMasters({ pending: false, error: null, data: minimal });
        setMasterId("");
      })
      .catch(() => {
        if (!cancelled) {
          setMasters({ pending: false, error: t("public.booking.loadCatalogFailed"), data: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasTenantContext, locale, serviceId, t]);

  const canSearchSlots = useMemo(() => Boolean(serviceId && date), [serviceId, date]);
  const masterNameById = useMemo(
    () => Object.fromEntries(masters.data.map((item) => [item.id, item.displayName])),
    [masters.data]
  );
  const stepState = useMemo(
    () => ({
      hasSelection: Boolean(serviceId && date),
      hasSlot: Boolean(selectedSlot),
      hasClient: Boolean(bookingCreated)
    }),
    [serviceId, date, selectedSlot, bookingCreated]
  );

  async function loadSlots() {
    if (!canSearchSlots) {
      return;
    }

    setSlots((state) => ({ ...state, pending: true, error: null }));
    try {
      const items = await listPublicSlots({
        serviceId,
        date,
        masterId: masterId || undefined
      });
      setSlots({ pending: false, error: null, data: items });
    } catch {
      setSlots({ pending: false, error: t("public.booking.loadSlotsFailed"), data: [] });
    }
  }

  return (
    <section className={embedded ? "page-shell" : "section page-shell"}>
      {!embedded ? <h1>{t("booking.title")}</h1> : null}
      <p>{embedded ? t("public.tenant.bookingSubtitle") : t("booking.subtitle")}</p>
      {!hasTenantContext ? (
        <EmptyState title={t("public.tenant.notLinkedTitle")} description={t("public.tenant.notLinkedDescription")} />
      ) : null}
      {hasTenantContext ? (
        <>
      <div className="stepper">
        <div className={`stepper-item ${stepState.hasSelection ? "done" : "active"}`}>
          <span>1</span>
          <p>{t("booking.step.selection")}</p>
        </div>
        <div className={`stepper-item ${stepState.hasSlot ? "done" : ""}`}>
          <span>2</span>
          <p>{t("booking.step.slot")}</p>
        </div>
        <div className={`stepper-item ${stepState.hasClient ? "done" : ""}`}>
          <span>3</span>
          <p>{t("booking.step.client")}</p>
        </div>
      </div>

      <div className="booking-controls">
        <label>
          {t("booking.service")}
          <select value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
            {services.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("booking.master")}
          <select value={masterId} onChange={(event) => setMasterId(event.target.value)}>
            <option value="">{t("booking.masterAny")}</option>
            {masters.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("booking.date")}
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>

        <button className="btn btn-primary" type="button" onClick={loadSlots} disabled={!canSearchSlots || slots.pending}>
          {slots.pending ? t("booking.loadingSlots") : t("booking.findSlots")}
        </button>
      </div>

      {services.pending ? <LoadingState text={t("booking.loadingServices")} /> : null}
      {services.error ? <ErrorState text={services.error} /> : null}
      {masters.pending ? <LoadingState text={t("booking.loadingMasters")} /> : null}
      {masters.error ? <ErrorState text={masters.error} /> : null}

      <div className="slots-grid">
        {slots.data.map((slot) => (
          <article
            key={`${slot.masterId}-${slot.startAt}`}
            className={`slot-card card-hover ${selectedSlot?.startAt === slot.startAt ? "slot-selected" : ""}`}
          >
            <h3>{slotLabel(slot, locale)}</h3>
            <p>
              {t("booking.master")}: {masterNameById[slot.masterId] ?? slot.masterId}
            </p>
            <button className="btn btn-ghost" type="button" onClick={() => setSelectedSlot(slot)}>
              {t("booking.selectSlot")}
            </button>
          </article>
        ))}
      </div>

      {!slots.pending && !slots.error && slots.data.length === 0 ? (
        <EmptyState title={t("booking.noSlotsTitle")} description={t("booking.noSlotsDescription")} />
      ) : null}
      {slots.error ? <ErrorState text={slots.error} /> : null}

      <section className="settings-card booking-form-card">
        <h2>{t("booking.clientDetails")}</h2>
        {selectedSlot ? (
          <p className="status-muted">
            {t("booking.selected")}: {slotLabel(selectedSlot, locale)}
          </p>
        ) : null}
        <form
          className="booking-client-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedSlot || !serviceId) {
              setBookingMessage(t("booking.slotRequired"));
              setBookingHasError(true);
              return;
            }

            const formData = new FormData(event.currentTarget);
            const clientName = String(formData.get("clientName") ?? "").trim();
            const clientPhoneE164 = String(formData.get("clientPhoneE164") ?? "").trim();
            const clientEmail = String(formData.get("clientEmail") ?? "").trim();

            if (!clientName || !clientPhoneE164) {
              setBookingMessage(t("booking.namePhoneRequired"));
              setBookingHasError(true);
              return;
            }

            setBookingPending(true);
            setBookingMessage(null);
            setBookingCreated(false);
            setBookingHasError(false);
            createPublicBooking({
              serviceId,
              masterId: selectedSlot.masterId || undefined,
              clientName,
              clientPhoneE164,
              clientEmail: clientEmail || undefined,
              clientLocale: locale,
              startAt: selectedSlot.startAt,
              endAt: selectedSlot.endAt
            })
              .then((data) => {
                setBookingMessage(`${t("booking.createdPrefix")}: ${data.id}`);
                setBookingCreated(true);
                setBookingHasError(false);
              })
              .catch(() => {
                setBookingMessage(t("booking.createFailed"));
                setBookingHasError(true);
              })
              .finally(() => setBookingPending(false));
          }}
        >
          <label>
            {t("booking.fullName")}
            <input name="clientName" type="text" required placeholder={t("booking.placeholder.name")} />
          </label>
          <label>
            {t("booking.phone")}
            <input name="clientPhoneE164" type="text" required placeholder={t("booking.placeholder.phone")} />
          </label>
          <label>
            {t("booking.emailOptional")}
            <input name="clientEmail" type="email" placeholder={t("booking.placeholder.email")} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={bookingPending}>
            {bookingPending ? t("booking.submitting") : t("booking.create")}
          </button>
        </form>
        {bookingMessage ? <p className={bookingHasError ? "status-error" : "status-success"}>{bookingMessage}</p> : null}
      </section>
        </>
      ) : null}
    </section>
  );
}
