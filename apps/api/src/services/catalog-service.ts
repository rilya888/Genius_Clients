import { CatalogRepository } from "../repositories";

export class CatalogService {
  private readonly catalogRepository = new CatalogRepository();

  private buildLocaleChain(requested?: string, tenantDefault?: string): string[] {
    const chain = [requested, tenantDefault, "en"].filter((value): value is string => Boolean(value));
    return [...new Set(chain)];
  }

  async listMasters(tenantId: string, locale?: string) {
    const base = await this.catalogRepository.listActiveMasters(tenantId);
    const tenantDefault = await this.catalogRepository.findTenantDefaultLocale(tenantId);
    const localeChain = this.buildLocaleChain(locale, tenantDefault);
    const translations = await this.catalogRepository.listMasterTranslationsByLocales(tenantId, localeChain);
    const translationById = new Map<string, Map<string, string>>();

    for (const item of translations) {
      const byLocale = translationById.get(item.masterId) ?? new Map<string, string>();
      byLocale.set(item.locale, item.displayName);
      translationById.set(item.masterId, byLocale);
    }

    return base.map((item) => {
      const byLocale = translationById.get(item.id);
      const translated = byLocale
        ? localeChain.map((loc) => byLocale.get(loc)).find((value): value is string => Boolean(value))
        : undefined;

      return {
        ...item,
        displayName: translated ?? item.displayName
      };
    });
  }

  async listServices(tenantId: string, locale?: string) {
    const base = await this.catalogRepository.listActiveServices(tenantId);
    const tenantDefault = await this.catalogRepository.findTenantDefaultLocale(tenantId);
    const localeChain = this.buildLocaleChain(locale, tenantDefault);
    const translations = await this.catalogRepository.listServiceTranslationsByLocales(tenantId, localeChain);
    const translationById = new Map<string, Map<string, { displayName: string; description: string | null }>>();

    for (const item of translations) {
      const byLocale =
        translationById.get(item.serviceId) ??
        new Map<string, { displayName: string; description: string | null }>();
      byLocale.set(item.locale, {
        displayName: item.displayName,
        description: item.description
      });
      translationById.set(item.serviceId, byLocale);
    }

    return base.map((item) => {
      const byLocale = translationById.get(item.id);
      const translated = byLocale
        ? localeChain.map((loc) => byLocale.get(loc)).find((value) => Boolean(value))
        : undefined;

      return {
        ...item,
        displayName: translated?.displayName ?? item.displayName,
        description: translated?.description ?? null
      };
    });
  }
}
