import { useEffect, useState } from "react";
import { listAdminServices } from "../shared/api/adminApi";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { useI18n } from "../shared/i18n/I18nProvider";

type ServiceItem = {
  id: string;
  displayName: string;
  durationMinutes: number;
  priceCents: number | null;
};

export function ServicesPage() {
  const { t } = useI18n();
  const [state, setState] = useState<{
    pending: boolean;
    error: string | null;
    data: ServiceItem[];
  }>({
    pending: true,
    error: null,
    data: []
  });

  useEffect(() => {
    let cancelled = false;
    listAdminServices()
      .then((items) => {
        if (!cancelled) {
          setState({
            pending: false,
            error: null,
            data: items.map((item) => ({
              id: item.id,
              displayName: item.displayName,
              durationMinutes: item.durationMinutes,
              priceCents: item.priceCents
            }))
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ pending: false, error: t("services.loadFailed"), data: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page-shell">
      <h1>{t("services.title")}</h1>
      {state.pending ? <LoadingState text={t("services.loading")} /> : null}
      {state.error ? <ErrorState text={state.error} /> : null}

      {!state.pending && !state.error && state.data.length === 0 ? (
        <EmptyState title={t("services.emptyTitle")} description={t("services.emptyDescription")} />
      ) : null}

      <div className="feature-grid">
        {state.data.map((service) => (
          <article className="service-card card-hover" key={service.id}>
            <h3>{service.displayName}</h3>
            <p>{service.durationMinutes}m</p>
            <p>{service.priceCents ? `€${(service.priceCents / 100).toFixed(2)}` : t("services.priceUnset")}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
