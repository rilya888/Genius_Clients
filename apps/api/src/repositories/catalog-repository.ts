import { and, asc, eq, inArray } from "drizzle-orm";
import {
  masterTranslations,
  masters,
  serviceTranslations,
  services,
  tenants
} from "@genius/db";
import { getDb } from "../lib/db";

export class CatalogRepository {
  async findTenantDefaultLocale(tenantId: string) {
    const db = getDb();
    const [tenant] = await db
      .select({
        defaultLocale: tenants.defaultLocale
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    return tenant?.defaultLocale ?? "it";
  }

  async listActiveMasters(tenantId: string) {
    const db = getDb();
    return db
      .select({
        id: masters.id,
        displayName: masters.displayName
      })
      .from(masters)
      .where(and(eq(masters.tenantId, tenantId), eq(masters.isActive, true)))
      .orderBy(asc(masters.displayName));
  }

  async listActiveServices(tenantId: string) {
    const db = getDb();
    return db
      .select({
        id: services.id,
        displayName: services.displayName,
        durationMinutes: services.durationMinutes,
        priceCents: services.priceCents,
        sortOrder: services.sortOrder
      })
      .from(services)
      .where(and(eq(services.tenantId, tenantId), eq(services.isActive, true)))
      .orderBy(asc(services.sortOrder), asc(services.displayName));
  }

  async listMasterTranslationsByLocales(tenantId: string, locales: string[]) {
    const db = getDb();
    return db
      .select({
        masterId: masterTranslations.masterId,
        locale: masterTranslations.locale,
        displayName: masterTranslations.displayName
      })
      .from(masterTranslations)
      .innerJoin(masters, eq(masters.id, masterTranslations.masterId))
      .where(and(eq(masters.tenantId, tenantId), inArray(masterTranslations.locale, locales)));
  }

  async listServiceTranslationsByLocales(tenantId: string, locales: string[]) {
    const db = getDb();
    return db
      .select({
        serviceId: serviceTranslations.serviceId,
        locale: serviceTranslations.locale,
        displayName: serviceTranslations.displayName,
        description: serviceTranslations.description
      })
      .from(serviceTranslations)
      .innerJoin(services, eq(services.id, serviceTranslations.serviceId))
      .where(and(eq(services.tenantId, tenantId), inArray(serviceTranslations.locale, locales)));
  }
}
