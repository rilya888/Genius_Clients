import { appError } from "../lib/http";
import { AuditRepository, StripeRepository, WebhookRepository } from "../repositories";
import { sha256 } from "../lib/hash";
import { BillingService } from "./billing-service";

export class WebhookService {
  private readonly webhookRepository = new WebhookRepository();
  private readonly auditRepository = new AuditRepository();
  private readonly stripeRepository = new StripeRepository();
  private readonly billingService = new BillingService();
  private readonly stripeAllowedEventTypes = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted"
  ]);

  private async createWebhookAudit(input: {
    tenantId?: string | null;
    action:
      | "webhook_event_processed"
      | "webhook_event_failed"
      | "webhook_event_deduplicated"
      | "webhook_event_ignored";
    entityId?: string;
    meta?: unknown;
  }) {
    if (!input.tenantId) {
      return;
    }

    await this.auditRepository.create({
      tenantId: input.tenantId,
      action: input.action,
      entity: "webhook_event",
      entityId: input.entityId,
      meta: input.meta
    });
  }

  private async processProviderEvent(input: {
    provider: "whatsapp" | "telegram" | "stripe";
    providerEventId: string;
    eventType: string;
    payloadJson: unknown;
    tenantId?: string | null;
    onProcess?: () => Promise<void>;
  }) {
    const existing = await this.webhookRepository.findByProviderEventId(
      input.provider,
      input.providerEventId
    );
    if (existing) {
      await this.createWebhookAudit({
        tenantId: input.tenantId,
        action: "webhook_event_deduplicated",
        entityId: existing.id,
        meta: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          eventType: input.eventType
        }
      });
      return { accepted: true, deduplicated: true, eventId: existing.id };
    }

    const created = await this.webhookRepository.createReceived(input);
    if (!created) {
      const already = await this.webhookRepository.findByProviderEventId(
        input.provider,
        input.providerEventId
      );
      if (already) {
        await this.createWebhookAudit({
          tenantId: input.tenantId,
          action: "webhook_event_deduplicated",
          entityId: already.id,
          meta: {
            provider: input.provider,
            providerEventId: input.providerEventId,
            eventType: input.eventType
          }
        });
      }
      return {
        accepted: true,
        deduplicated: true,
        eventId: already?.id ?? input.providerEventId
      };
    }

    try {
      if (input.onProcess) {
        await input.onProcess();
      }
      await this.webhookRepository.markProcessed(created.id);
      await this.createWebhookAudit({
        tenantId: input.tenantId,
        action: "webhook_event_processed",
        entityId: created.id,
        meta: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          eventType: input.eventType
        }
      });
      return { accepted: true, deduplicated: false, eventId: created.id };
    } catch (error) {
      await this.webhookRepository.markFailed({
        eventId: created.id,
        errorCode: "WEBHOOK_PROCESSING_FAILED",
        errorMessage: error instanceof Error ? error.message : "unknown webhook processing error"
      });
      await this.createWebhookAudit({
        tenantId: input.tenantId,
        action: "webhook_event_failed",
        entityId: created.id,
        meta: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          eventType: input.eventType
        }
      });
      throw appError("INTERNAL_ERROR", { reason: "webhook_processing_failed" });
    }
  }

  async handleWhatsApp(input: { providerEventId: string; eventType: string; payloadJson: unknown }) {
    return this.processProviderEvent({
      provider: "whatsapp",
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      payloadJson: input.payloadJson
    });
  }

  async handleTelegram(input: { providerEventId: string; eventType: string; payloadJson: unknown }) {
    return this.processProviderEvent({
      provider: "telegram",
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      payloadJson: input.payloadJson
    });
  }

  async handleStripe(input: { providerEventId: string; eventType: string; payloadJson: unknown }) {
    if (!this.stripeAllowedEventTypes.has(input.eventType)) {
      return { accepted: true, ignored: true, reason: "event_type_not_allowed" };
    }

    const stripeObject = this.asRecord(this.asRecord(input.payloadJson).data).object;
    const payloadObject = this.asRecord(stripeObject);
    const tenantId = this.extractTenantId(payloadObject);
    const customerId = this.extractStripeCustomerId(payloadObject);
    const email = this.extractEmail(payloadObject);
    const userId = this.extractUserId(payloadObject);

    return this.processProviderEvent({
      provider: "stripe",
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      payloadJson: input.payloadJson,
      tenantId,
      onProcess: async () => {
        if (!tenantId || !customerId) {
          const billing = await this.billingService.applyStripeSubscriptionEvent({
            eventType: input.eventType,
            payloadJson: input.payloadJson
          });
          if (!billing.applied) {
            return;
          }
          return;
        }

        await this.stripeRepository.upsertCustomer({
          tenantId,
          stripeCustomerId: customerId,
          email,
          userId
        });

        await this.billingService.applyStripeSubscriptionEvent({
          eventType: input.eventType,
          payloadJson: input.payloadJson
        });
      }
    });
  }

  buildFallbackEventId(payloadJson: unknown): string {
    return sha256(JSON.stringify(payloadJson));
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  }

  private extractTenantId(payloadObject: Record<string, unknown>): string | null {
    const metadata = this.asRecord(payloadObject.metadata);
    const tenantId = metadata.tenant_id;
    return typeof tenantId === "string" && tenantId ? tenantId : null;
  }

  private extractStripeCustomerId(payloadObject: Record<string, unknown>): string | null {
    const direct = payloadObject.id;
    if (typeof direct === "string" && direct.startsWith("cus_")) {
      return direct;
    }

    const customer = payloadObject.customer;
    return typeof customer === "string" && customer.startsWith("cus_") ? customer : null;
  }

  private extractEmail(payloadObject: Record<string, unknown>): string | null {
    const directEmail = payloadObject.email;
    if (typeof directEmail === "string" && directEmail) {
      return directEmail.toLowerCase();
    }
    const customerEmail = payloadObject.customer_email;
    return typeof customerEmail === "string" && customerEmail
      ? customerEmail.toLowerCase()
      : null;
  }

  private extractUserId(payloadObject: Record<string, unknown>): string | null {
    const metadata = this.asRecord(payloadObject.metadata);
    const userId = metadata.user_id;
    return typeof userId === "string" && userId ? userId : null;
  }
}
