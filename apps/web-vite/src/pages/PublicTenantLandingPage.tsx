import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { PublicBookingPage } from "./PublicBookingPage";
import { getPublicTenantProfile, listPublicMasters, listPublicServices, type PublicMaster, type PublicService } from "../shared/api/publicApi";
import { useI18n } from "../shared/i18n/I18nProvider";
import { resolveCurrentTenantSlug } from "../shared/routing/tenant-host";

type PublicTenantLandingState = {
  pending: boolean;
  error: string | null;
  tenant: Awaited<ReturnType<typeof getPublicTenantProfile>> | null;
  services: PublicService[];
  masters: PublicMaster[];
};

const initialState: PublicTenantLandingState = {
  pending: true,
  error: null,
  tenant: null,
  services: [],
  masters: []
};

export function PublicTenantLandingPage() {
  const { locale, t } = useI18n();
  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params.tenantSlug ?? resolveCurrentTenantSlug();
  const [state, setState] = useState<PublicTenantLandingState>(initialState);

  useEffect(() => {
    if (!tenantSlug) {
      setState({
        pending: false,
        error: t("public.tenant.notLinkedDescription"),
        tenant: null,
        services: [],
        masters: []
      });
      return;
    }

    let cancelled = false;
    setState(initialState);

    Promise.all([getPublicTenantProfile(tenantSlug), listPublicServices(locale), listPublicMasters(locale)])
      .then(([tenant, services, masters]) => {
        if (cancelled) {
          return;
        }
        setState({
          pending: false,
          error: null,
          tenant,
          services,
          masters
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setState({
          pending: false,
          error: t("public.tenant.loadFailed"),
          tenant: null,
          services: [],
          masters: []
        });
      });

    return () => {
      cancelled = true;
    };
  }, [locale, tenantSlug, t]);

  const hasCatalog = useMemo(() => state.services.length > 0, [state.services.length]);

  return (
    <>
      <section className="section hero">
        {state.pending ? <LoadingState text={t("public.tenant.loading")} /> : null}
        {state.error ? (
          <ErrorState text={state.error} />
        ) : null}
        {!state.pending && !state.error && state.tenant ? (
          <div style={{ display: "grid", gap: "1.5rem" }}>
            <div>
              <p className="eyebrow">{t("public.tenant.eyebrow")}</p>
              <h1>{state.tenant.name}</h1>
              <p className="hero-subtitle">{t("public.tenant.subtitle")}</p>
              <div className="inline-actions">
                <a className="btn btn-primary" href="#booking">
                  {t("public.tenant.bookNow")}
                </a>
              </div>
            </div>
            <div className="feature-grid">
              <article className="feature-card card-hover">
                <h3>{t("public.tenant.timezone")}</h3>
                <p>{state.tenant.timezone}</p>
              </article>
              <article className="feature-card card-hover">
                <h3>{t("public.tenant.locale")}</h3>
                <p>{state.tenant.defaultLocale.toUpperCase()}</p>
              </article>
              <article className="feature-card card-hover">
                <h3>{t("public.tenant.services")}</h3>
                <p>{state.services.length}</p>
              </article>
              <article className="feature-card card-hover">
                <h3>{t("public.tenant.staff")}</h3>
                <p>{state.masters.length}</p>
              </article>
            </div>
          </div>
        ) : null}
      </section>

      {!state.pending && !state.error ? (
        <>
          <section className="section">
            <h2>{t("public.tenant.catalogTitle")}</h2>
            {hasCatalog ? (
              <div className="feature-grid">
                {state.services.map((service) => (
                  <article key={service.id} className="feature-card card-hover">
                    <h3>{service.displayName}</h3>
                    <p>
                      {service.durationMinutes} {t("public.tenant.minutes")}
                    </p>
                    <p>{service.priceCents === null ? t("public.tenant.priceOnRequest") : `€${(service.priceCents / 100).toFixed(2)}`}</p>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title={t("public.tenant.notReadyTitle")} description={t("public.tenant.notReadyDescription")} />
            )}
          </section>

          {state.masters.length > 0 ? (
            <section className="section">
              <h2>{t("public.tenant.teamTitle")}</h2>
              <div className="feature-grid">
                {state.masters.map((master) => (
                  <article key={master.id} className="feature-card card-hover">
                    <h3>{master.displayName}</h3>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {hasCatalog ? (
            <section className="section" id="booking">
              <PublicBookingPage embedded />
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
