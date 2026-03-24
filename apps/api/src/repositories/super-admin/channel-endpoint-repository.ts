import { and, desc, eq, sql } from "drizzle-orm";
import { channelEndpointEvents, channelEndpointsV2, tenants } from "@genius/db";
import { getDb } from "../../lib/db";

function isUndefinedTableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return String((error as { code: unknown }).code) === "42P01";
}

export type WhatsAppEndpointRow = {
  id: string;
  provider: string;
  externalEndpointId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  accountId: string;
  salonId: string;
  environment: "sandbox" | "production";
  bindingStatus: "draft" | "pending_verification" | "connected" | "disabled";
  displayName: string | null;
  displayPhoneNumber: string | null;
  e164: string | null;
  verifiedName: string | null;
  wabaId: string | null;
  businessId: string | null;
  tokenSource: "unknown" | "map" | "fallback";
  templateStatus: "unknown" | "not_ready" | "ready";
  profileStatus: "unknown" | "incomplete" | "ready";
  qualityRating: string | null;
  metaStatus: string | null;
  codeVerificationStatus: string | null;
  notes: string | null;
  isActive: boolean;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeEndpointRow(
  row: Omit<
    WhatsAppEndpointRow,
    "environment" | "bindingStatus" | "tokenSource" | "templateStatus" | "profileStatus"
  > & {
    environment: string;
    bindingStatus: string;
    tokenSource: string;
    templateStatus: string;
    profileStatus: string;
  }
): WhatsAppEndpointRow {
  return {
    ...row,
    environment: row.environment as WhatsAppEndpointRow["environment"],
    bindingStatus: row.bindingStatus as WhatsAppEndpointRow["bindingStatus"],
    tokenSource: row.tokenSource as WhatsAppEndpointRow["tokenSource"],
    templateStatus: row.templateStatus as WhatsAppEndpointRow["templateStatus"],
    profileStatus: row.profileStatus as WhatsAppEndpointRow["profileStatus"]
  };
}

export class SuperAdminChannelEndpointRepository {
  async listWhatsAppEndpoints(): Promise<WhatsAppEndpointRow[]> {
    const db = getDb();
    try {
      const items = await db
        .select({
          id: channelEndpointsV2.id,
          provider: channelEndpointsV2.provider,
          externalEndpointId: channelEndpointsV2.externalEndpointId,
          tenantId: channelEndpointsV2.tenantId,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
          accountId: channelEndpointsV2.accountId,
          salonId: channelEndpointsV2.salonId,
          environment: channelEndpointsV2.environment,
          bindingStatus: channelEndpointsV2.bindingStatus,
          displayName: channelEndpointsV2.displayName,
          displayPhoneNumber: channelEndpointsV2.displayPhoneNumber,
          e164: channelEndpointsV2.e164,
          verifiedName: channelEndpointsV2.verifiedName,
          wabaId: channelEndpointsV2.wabaId,
          businessId: channelEndpointsV2.businessId,
          tokenSource: channelEndpointsV2.tokenSource,
          templateStatus: channelEndpointsV2.templateStatus,
          profileStatus: channelEndpointsV2.profileStatus,
          qualityRating: channelEndpointsV2.qualityRating,
          metaStatus: channelEndpointsV2.metaStatus,
          codeVerificationStatus: channelEndpointsV2.codeVerificationStatus,
          notes: channelEndpointsV2.notes,
          isActive: channelEndpointsV2.isActive,
          connectedAt: channelEndpointsV2.connectedAt,
          disconnectedAt: channelEndpointsV2.disconnectedAt,
          lastInboundAt: channelEndpointsV2.lastInboundAt,
          lastOutboundAt: channelEndpointsV2.lastOutboundAt,
          createdBy: channelEndpointsV2.createdBy,
          updatedBy: channelEndpointsV2.updatedBy,
          createdAt: channelEndpointsV2.createdAt,
          updatedAt: channelEndpointsV2.updatedAt
        })
        .from(channelEndpointsV2)
        .innerJoin(tenants, eq(channelEndpointsV2.tenantId, tenants.id))
        .where(eq(channelEndpointsV2.provider, "whatsapp"))
        .orderBy(desc(channelEndpointsV2.updatedAt), desc(channelEndpointsV2.createdAt));
      return items.map(normalizeEndpointRow);
    } catch (error) {
      if (isUndefinedTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  async getEndpointById(id: string): Promise<WhatsAppEndpointRow | null> {
    const db = getDb();
    try {
      const items = await db
        .select({
          id: channelEndpointsV2.id,
          provider: channelEndpointsV2.provider,
          externalEndpointId: channelEndpointsV2.externalEndpointId,
          tenantId: channelEndpointsV2.tenantId,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
          accountId: channelEndpointsV2.accountId,
          salonId: channelEndpointsV2.salonId,
          environment: channelEndpointsV2.environment,
          bindingStatus: channelEndpointsV2.bindingStatus,
          displayName: channelEndpointsV2.displayName,
          displayPhoneNumber: channelEndpointsV2.displayPhoneNumber,
          e164: channelEndpointsV2.e164,
          verifiedName: channelEndpointsV2.verifiedName,
          wabaId: channelEndpointsV2.wabaId,
          businessId: channelEndpointsV2.businessId,
          tokenSource: channelEndpointsV2.tokenSource,
          templateStatus: channelEndpointsV2.templateStatus,
          profileStatus: channelEndpointsV2.profileStatus,
          qualityRating: channelEndpointsV2.qualityRating,
          metaStatus: channelEndpointsV2.metaStatus,
          codeVerificationStatus: channelEndpointsV2.codeVerificationStatus,
          notes: channelEndpointsV2.notes,
          isActive: channelEndpointsV2.isActive,
          connectedAt: channelEndpointsV2.connectedAt,
          disconnectedAt: channelEndpointsV2.disconnectedAt,
          lastInboundAt: channelEndpointsV2.lastInboundAt,
          lastOutboundAt: channelEndpointsV2.lastOutboundAt,
          createdBy: channelEndpointsV2.createdBy,
          updatedBy: channelEndpointsV2.updatedBy,
          createdAt: channelEndpointsV2.createdAt,
          updatedAt: channelEndpointsV2.updatedAt
        })
        .from(channelEndpointsV2)
        .innerJoin(tenants, eq(channelEndpointsV2.tenantId, tenants.id))
        .where(and(eq(channelEndpointsV2.id, id), eq(channelEndpointsV2.provider, "whatsapp")))
        .limit(1);
      return items[0] ? normalizeEndpointRow(items[0]) : null;
    } catch (error) {
      if (isUndefinedTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async upsertWhatsAppEndpoint(input: {
    id?: string;
    tenantId: string;
    accountId: string;
    salonId: string;
    externalEndpointId: string;
    environment: "sandbox" | "production";
    bindingStatus: "draft" | "pending_verification" | "connected" | "disabled";
    displayName?: string | null;
    displayPhoneNumber?: string | null;
    e164?: string | null;
    verifiedName?: string | null;
    wabaId?: string | null;
    businessId?: string | null;
    tokenSource: "unknown" | "map" | "fallback";
    templateStatus: "unknown" | "not_ready" | "ready";
    profileStatus: "unknown" | "incomplete" | "ready";
    qualityRating?: string | null;
    metaStatus?: string | null;
    codeVerificationStatus?: string | null;
    notes?: string | null;
    isActive: boolean;
    connectedAt?: Date | null;
    disconnectedAt?: Date | null;
    lastInboundAt?: Date | null;
    lastOutboundAt?: Date | null;
    actor?: string | null;
  }): Promise<WhatsAppEndpointRow | null> {
    const db = getDb();
    const payload = {
      provider: "whatsapp" as const,
      externalEndpointId: input.externalEndpointId,
      tenantId: input.tenantId,
      accountId: input.accountId,
      salonId: input.salonId,
      environment: input.environment,
      bindingStatus: input.bindingStatus,
      displayName: input.displayName ?? null,
      displayPhoneNumber: input.displayPhoneNumber ?? null,
      e164: input.e164 ?? null,
      verifiedName: input.verifiedName ?? null,
      wabaId: input.wabaId ?? null,
      businessId: input.businessId ?? null,
      tokenSource: input.tokenSource,
      templateStatus: input.templateStatus,
      profileStatus: input.profileStatus,
      qualityRating: input.qualityRating ?? null,
      metaStatus: input.metaStatus ?? null,
      codeVerificationStatus: input.codeVerificationStatus ?? null,
      notes: input.notes ?? null,
      isActive: input.isActive,
      connectedAt: input.connectedAt ?? null,
      disconnectedAt: input.disconnectedAt ?? null,
      lastInboundAt: input.lastInboundAt ?? null,
      lastOutboundAt: input.lastOutboundAt ?? null,
      updatedBy: input.actor ?? null,
      updatedAt: new Date()
    };

    if (input.id) {
      await db.update(channelEndpointsV2).set(payload).where(eq(channelEndpointsV2.id, input.id));
      const updated = await this.getEndpointById(input.id);
      if (updated) {
        await this.createEvent({
          endpointId: updated.id,
          action: "super_admin.whatsapp_endpoint.updated",
          actor: input.actor ?? null,
          payloadJson: updated
        });
      }
      return updated;
    }

    const [created] = await db
      .insert(channelEndpointsV2)
      .values({
        ...payload,
        createdBy: input.actor ?? null
      })
      .onConflictDoUpdate({
        target: [channelEndpointsV2.provider, channelEndpointsV2.externalEndpointId],
        set: payload
      })
      .returning({ id: channelEndpointsV2.id });

    const endpoint = created ? await this.getEndpointById(created.id) : null;
    if (endpoint) {
      await this.createEvent({
        endpointId: endpoint.id,
        action: "super_admin.whatsapp_endpoint.upserted",
        actor: input.actor ?? null,
        payloadJson: endpoint
      });
    }
    return endpoint;
  }

  async resolveActiveRoute(input: {
    provider: string;
    externalEndpointId: string;
  }): Promise<{
    accountId: string;
    salonId: string;
    externalEndpointId: string;
    tenantId: string;
    tenantSlug: string;
  } | null> {
    const db = getDb();
    try {
      const items = await db
        .select({
          accountId: channelEndpointsV2.accountId,
          salonId: channelEndpointsV2.salonId,
          externalEndpointId: channelEndpointsV2.externalEndpointId,
          tenantId: channelEndpointsV2.tenantId,
          tenantSlug: tenants.slug
        })
        .from(channelEndpointsV2)
        .innerJoin(tenants, eq(channelEndpointsV2.tenantId, tenants.id))
        .where(
          and(
            eq(channelEndpointsV2.provider, input.provider),
            eq(channelEndpointsV2.externalEndpointId, input.externalEndpointId),
            eq(channelEndpointsV2.isActive, true),
            eq(channelEndpointsV2.bindingStatus, "connected")
          )
        )
        .limit(1);
      return items[0] ?? null;
    } catch (error) {
      if (isUndefinedTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async countActiveWhatsAppEndpoints(): Promise<number> {
    const db = getDb();
    try {
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(channelEndpointsV2)
        .where(
          and(
            eq(channelEndpointsV2.provider, "whatsapp"),
            eq(channelEndpointsV2.isActive, true),
            eq(channelEndpointsV2.bindingStatus, "connected")
          )
        );
      return result[0]?.count ?? 0;
    } catch (error) {
      if (isUndefinedTableError(error)) {
        return 0;
      }
      throw error;
    }
  }

  private async createEvent(input: {
    endpointId: string;
    action: string;
    actor?: string | null;
    payloadJson?: unknown;
  }) {
    const db = getDb();
    try {
      await db.insert(channelEndpointEvents).values({
        endpointId: input.endpointId,
        action: input.action,
        actor: input.actor ?? null,
        payloadJson: input.payloadJson ?? null
      });
    } catch (error) {
      if (isUndefinedTableError(error)) {
        return;
      }
      throw error;
    }
  }
}
