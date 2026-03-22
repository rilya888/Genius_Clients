import type { SupportedLocale } from "@genius/i18n";

export type TenantTerminologyConfig = {
  serviceSingular?: string;
  servicePlural?: string;
  specialistSingular?: string;
  specialistPlural?: string;
  appointmentSingular?: string;
  appointmentPlural?: string;
};

export type TenantFlowConfig = {
  specialistSelection?: "required" | "optional" | "hidden";
};

export type ResolvedTenantTerminology = {
  serviceSingular: string;
  servicePlural: string;
  specialistSingular: string;
  specialistPlural: string;
  appointmentSingular: string;
  appointmentPlural: string;
};

export function normalizeTenantTerminologyConfig(value: unknown): TenantTerminologyConfig {
  const source = typeof value === "object" && value ? (value as Record<string, unknown>) : {};
  return {
    serviceSingular: sanitizeTerm(source.serviceSingular),
    servicePlural: sanitizeTerm(source.servicePlural),
    specialistSingular: sanitizeTerm(source.specialistSingular),
    specialistPlural: sanitizeTerm(source.specialistPlural),
    appointmentSingular: sanitizeTerm(source.appointmentSingular),
    appointmentPlural: sanitizeTerm(source.appointmentPlural)
  };
}

export function normalizeTenantFlowConfig(value: unknown): TenantFlowConfig {
  const source = typeof value === "object" && value ? (value as Record<string, unknown>) : {};
  const specialistSelection =
    source.specialistSelection === "required" ||
    source.specialistSelection === "optional" ||
    source.specialistSelection === "hidden"
      ? source.specialistSelection
      : "required";
  return { specialistSelection };
}

export function resolveTenantTerminology(
  locale: SupportedLocale,
  terminology?: TenantTerminologyConfig | null
): ResolvedTenantTerminology {
  const defaults: ResolvedTenantTerminology =
    locale === "it"
      ? {
          serviceSingular: "servizio",
          servicePlural: "servizi",
          specialistSingular: "specialista",
          specialistPlural: "specialisti",
          appointmentSingular: "prenotazione",
          appointmentPlural: "prenotazioni"
        }
      : {
          serviceSingular: "service",
          servicePlural: "services",
          specialistSingular: "specialist",
          specialistPlural: "specialists",
          appointmentSingular: "booking",
          appointmentPlural: "bookings"
        };

  return {
    serviceSingular: terminology?.serviceSingular || defaults.serviceSingular,
    servicePlural: terminology?.servicePlural || defaults.servicePlural,
    specialistSingular: terminology?.specialistSingular || defaults.specialistSingular,
    specialistPlural: terminology?.specialistPlural || defaults.specialistPlural,
    appointmentSingular: terminology?.appointmentSingular || defaults.appointmentSingular,
    appointmentPlural: terminology?.appointmentPlural || defaults.appointmentPlural
  };
}

export function resolveSpecialistSelectionMode(flowConfig?: TenantFlowConfig | null) {
  return flowConfig?.specialistSelection ?? "required";
}

function sanitizeTerm(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 40);
  return normalized.length > 0 ? normalized : undefined;
}
