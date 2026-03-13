import { randomUUID } from "node:crypto";
import type { SupportedLocale } from "@genius/i18n";
import { createInitialSession, type ConversationIntent, type WhatsAppConversationSession } from "./whatsapp-conversation";
import { OPENAI_PROMPT_VERSION, buildBookingAssistantInstructions, buildConversationInput } from "./openai-prompts";
import { OpenAIResponsesClient, OpenAIResponsesError, type OpenAITurnType } from "./openai-responses-client";

type ServiceItem = {
  id: string;
  displayName: string;
  durationMinutes?: number;
};

type MasterItem = {
  id: string;
  displayName: string;
};

type SlotItem = {
  startAt: string;
  displayTime: string;
};

type BookingItem = {
  id: string;
  startAt: string;
  status: string;
};

type Choice = {
  id: string;
  title: string;
  description?: string;
};

type TenantBotConfig = {
  name: string;
  defaultLocale: SupportedLocale;
  timezone: string;
  openaiEnabled: boolean;
  openaiModel: string;
  humanHandoffEnabled: boolean;
  adminNotificationWhatsappE164?: string | null;
};

type ToolArtifact =
  | { kind: "service_list"; prompt: string; items: ServiceItem[]; intent?: ConversationIntent }
  | {
      kind: "master_list";
      prompt: string;
      serviceId?: string;
      serviceName?: string;
      items: MasterItem[];
      intent?: ConversationIntent;
    }
  | {
      kind: "date_list";
      prompt: string;
      serviceId?: string;
      serviceName?: string;
      masterId?: string;
      masterName?: string;
      items: Array<{ date: string; title: string; description?: string }>;
      intent?: ConversationIntent;
    }
  | {
      kind: "slot_list";
      prompt: string;
      serviceId?: string;
      serviceName?: string;
      masterId?: string;
      masterName?: string;
      date: string;
      items: SlotItem[];
      intent?: ConversationIntent;
    }
  | {
      kind: "booking_list";
      prompt: string;
      action: "cancel" | "reschedule";
      items: BookingItem[];
    }
  | { kind: "handoff"; prompt: string; summary: string; notified: boolean }
  | { kind: "none" };

export type AiOrchestratorDeps = {
  loadSession: (phone: string) => Promise<WhatsAppConversationSession | null>;
  saveSession: (phone: string, session: WhatsAppConversationSession) => Promise<void>;
  clearSession: (phone: string) => Promise<void>;
  sendText: (to: string, text: string) => Promise<void>;
  sendList: (to: string, bodyText: string, buttonText: string, choices: Choice[]) => Promise<void>;
  fetchServices: (locale: SupportedLocale) => Promise<ServiceItem[]>;
  fetchMasters: (locale: SupportedLocale, serviceId?: string) => Promise<MasterItem[]>;
  fetchSlots: (input: {
    serviceId: string;
    masterId?: string;
    date: string;
    locale: SupportedLocale;
  }) => Promise<SlotItem[]>;
  listBookingsByPhone: (input: { phone: string; limit?: number }) => Promise<BookingItem[]>;
  createBooking: (input: {
    serviceId: string;
    masterId?: string;
    startAtIso: string;
    phone: string;
    locale: SupportedLocale;
    clientName?: string;
  }) => Promise<string>;
  cancelBooking: (input: { bookingId: string; phone: string }) => Promise<string>;
  rescheduleBooking: (input: {
    bookingId: string;
    phone: string;
    serviceId: string;
    masterId?: string;
    startAtIso: string;
    locale: SupportedLocale;
  }) => Promise<string>;
  getTenantConfig: () => Promise<TenantBotConfig>;
  notifyAdminHandoff: (input: { phone: string; summary: string; locale: SupportedLocale }) => Promise<boolean>;
};

const RESTART_FLOW_TOKEN = "flow:restart";
const BACK_FLOW_TOKEN = "flow:back";
const MAX_TOOL_LOOPS = 6;
const MAX_CHAIN_RESTARTS_PER_MESSAGE = 1;

export async function processAiWhatsAppMessage(
  input: {
    from: string;
    text: string;
    locale: SupportedLocale;
    openAiApiKey: string;
    globalModel: string;
    globalEnabled: boolean;
  },
  deps: AiOrchestratorDeps
): Promise<{ handled: boolean }> {
  if (!input.text.trim() || !input.openAiApiKey || !input.globalEnabled) {
    return { handled: false };
  }

  const tenantConfig = await deps.getTenantConfig();
  if (!tenantConfig.openaiEnabled) {
    return { handled: false };
  }

  const detectedLocale = detectMessageLocale(input.text, input.locale, tenantConfig.defaultLocale);
  const traceId = randomUUID();
  let session = (await deps.loadSession(input.from)) ?? createInitialSession(detectedLocale);
  session.locale = detectedLocale;
  session.lastUserMessageAt = new Date().toISOString();
  session.currentMode = session.currentMode === "human_handoff" ? "human_handoff" : "ai_assisted";
  session.conversationTraceId = traceId;

  if (session.handoffStatus === "active" || session.currentMode === "human_handoff") {
    await deps.saveSession(input.from, session);
    await deps.sendText(
      input.from,
      detectedLocale === "it"
        ? "La richiesta e stata inoltrata all'amministratore. Attendi una risposta."
        : "Your request has been forwarded to the administrator. Please wait for a reply."
    );
    return { handled: true };
  }

  console.info("[bot][ai] inbound normalize", {
    traceId,
    from: maskPhone(input.from),
    locale: detectedLocale,
    state: session.state,
    intent: session.intent ?? "unknown",
    promptVersion: OPENAI_PROMPT_VERSION
  });

  const client = new OpenAIResponsesClient(input.openAiApiKey);

  try {
    const result = await runAiLoop(
      {
        client,
        model: tenantConfig.openaiModel || input.globalModel,
        locale: detectedLocale,
        tenantConfig,
        session,
        userText: input.text,
        phone: input.from,
        traceId
      },
      deps
    );

    session.lastOpenaiResponseId = result.lastResponseId;
    session.lastAiSummary = result.summary;
    session.aiFailureCount = 0;

    if (result.artifact.kind !== "none") {
      await renderArtifact({ from: input.from, locale: detectedLocale, session, artifact: result.artifact }, deps);
      return { handled: true };
    }

    if (result.outputText) {
      await deps.saveSession(input.from, session);
      await deps.sendText(input.from, sanitizeUserText(result.outputText));
      console.info("[bot][ai] final render", {
        traceId,
        mode: "text",
        usage: result.usage
      });
      return { handled: true };
    }

    return { handled: false };
  } catch (error) {
    const errorClass = classifyAiError(error);
    session.aiFailureCount = (session.aiFailureCount ?? 0) + 1;
    session.currentMode = "deterministic";
    await deps.saveSession(input.from, session);
    console.error("[bot][ai] failure", {
      traceId,
      error: error instanceof Error ? error.message : "unknown_error",
      errorClass,
      failures: session.aiFailureCount
    });

    if (tenantConfig.humanHandoffEnabled && (session.aiFailureCount ?? 0) >= 3) {
      const notified = await deps.notifyAdminHandoff({
        phone: input.from,
        summary: input.text.slice(0, 240),
        locale: detectedLocale
      });
      session.currentMode = "human_handoff";
      session.handoffStatus = notified ? "active" : "pending";
      await deps.saveSession(input.from, session);
      await deps.sendText(
        input.from,
        detectedLocale === "it"
          ? "Non riesco a completare la richiesta. La inoltro all'amministratore."
          : "I cannot complete the request right now. I am forwarding it to the administrator."
      );
      return { handled: true };
    }

    return { handled: false };
  }
}

async function runAiLoop(
  input: {
    client: OpenAIResponsesClient;
    model: string;
    locale: SupportedLocale;
    tenantConfig: TenantBotConfig;
    session: WhatsAppConversationSession;
    userText: string;
    phone: string;
    traceId: string;
  },
  deps: AiOrchestratorDeps
) {
  const instructions = buildBookingAssistantInstructions({
    locale: input.locale,
    tenantName: input.tenantConfig.name,
    tenantTimezone: input.tenantConfig.timezone,
    session: input.session
  });

  let previousResponseId = input.session.lastOpenaiResponseId;
  let requestInput: string | Array<{ type: "function_call_output"; call_id: string; output: string }> =
    buildConversationInput({
      locale: input.locale,
      userText: input.userText,
      session: input.session
    });
  let latestArtifact: ToolArtifact = { kind: "none" };
  let lastResponseId = previousResponseId;
  let lastUsage: Record<string, number> | null = null;
  let summary = input.userText.slice(0, 280);
  let turnType: OpenAITurnType = "user_input";
  let chainRestarts = 0;

  for (let step = 0; step < MAX_TOOL_LOOPS; step += 1) {
    console.info("[bot][ai] request", {
      traceId: input.traceId,
      step,
      turnType,
      chainRestarted: chainRestarts > 0,
      previousResponseIdPresent: Boolean(previousResponseId)
    });

    let response;
    try {
      response = await input.client.create({
        model: input.model,
        instructions,
        input: requestInput,
        turnType,
        tools: [...buildTools()],
        previousResponseId,
        metadata: {
          trace_id: input.traceId,
          prompt_version: OPENAI_PROMPT_VERSION,
          locale: input.locale
        }
      });
    } catch (error) {
      if (
        error instanceof OpenAIResponsesError &&
        error.code === "openai_tool_chain_invalid" &&
        chainRestarts < MAX_CHAIN_RESTARTS_PER_MESSAGE
      ) {
        chainRestarts += 1;
        previousResponseId = undefined;
        requestInput = buildConversationInput({
          locale: input.locale,
          userText: input.userText,
          session: input.session
        });
        latestArtifact = { kind: "none" };
        lastResponseId = undefined;
        lastUsage = null;
        summary = input.userText.slice(0, 280);
        turnType = "user_input";
        console.warn("[bot][ai] chain restart", {
          traceId: input.traceId,
          step,
          chainRestarted: true,
          chainRestartReason: error.code
        });
        step = -1;
        continue;
      }
      throw error;
    }

    lastResponseId = response.id;
    lastUsage = response.usage;
    previousResponseId = response.id;

    console.info("[bot][ai] response", {
      traceId: input.traceId,
      step,
      turnType,
      chainRestarted: chainRestarts > 0,
      previousResponseIdPresent: Boolean(previousResponseId),
      functionCalls: response.functionCalls.length,
      toolCallNames: response.functionCalls.map((call) => call.name),
      usage: response.usage
    });

    if (response.functionCalls.length === 0) {
      return {
        outputText: response.outputText,
        artifact: latestArtifact,
        lastResponseId,
        usage: lastUsage,
        summary
      };
    }

    const toolOutputs: Array<{ type: "function_call_output"; call_id: string; output: string }> = [];
    for (const call of response.functionCalls) {
      const args = safeJsonParse(call.arguments);
      const toolResult = await executeTool(call.name, args, {
        locale: input.locale,
        tenantConfig: input.tenantConfig,
        session: input.session,
        phone: input.phone
      }, deps);
      latestArtifact = toolResult.artifact;
      summary = toolResult.summary ?? summary;
      toolOutputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(toolResult.output)
      });
      console.info("[bot][ai] tool execution", {
        traceId: input.traceId,
        tool: call.name,
        artifact: toolResult.artifact.kind
      });
    }

    requestInput = toolOutputs;
    turnType = "tool_output";
    console.info("[bot][ai] tool output prepared", {
      traceId: input.traceId,
      step,
      toolOutputCount: toolOutputs.length
    });
  }

  throw new Error(chainRestarts > 0 ? "openai_chain_restart_exhausted" : "openai_tool_loop_limit_exceeded");
}

function buildTools() {
  return [
    {
      type: "function",
      name: "list_services",
      description: "List available services and optionally resolve a service by user text.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          intent: { type: "string", enum: ["new_booking", "check_availability"] }
        }
      }
    },
    {
      type: "function",
      name: "list_masters",
      description: "List available masters and optionally resolve a master by user text.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          serviceId: { type: "string" },
          query: { type: "string" },
          intent: { type: "string", enum: ["new_booking", "check_availability", "reschedule_booking"] }
        }
      }
    },
    {
      type: "function",
      name: "list_dates_with_slots",
      description: "List upcoming dates with available slots for a service and optional master.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["serviceId"],
        properties: {
          serviceId: { type: "string" },
          serviceName: { type: "string" },
          masterId: { type: "string" },
          masterName: { type: "string" },
          days: { type: "integer" },
          intent: { type: "string", enum: ["new_booking", "check_availability", "reschedule_booking"] }
        }
      }
    },
    {
      type: "function",
      name: "list_slots",
      description: "List available slots for a date, service, and optional master.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["serviceId", "date"],
        properties: {
          serviceId: { type: "string" },
          serviceName: { type: "string" },
          masterId: { type: "string" },
          masterName: { type: "string" },
          date: { type: "string" },
          intent: { type: "string", enum: ["new_booking", "check_availability", "reschedule_booking"] }
        }
      }
    },
    {
      type: "function",
      name: "list_user_bookings",
      description: "List the user's recent bookings for cancel or reschedule flows.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["cancel", "reschedule"] }
        }
      }
    },
    {
      type: "function",
      name: "create_booking_request",
      description: "Create a booking request after all booking fields are known.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["serviceId", "slotStartAt"],
        properties: {
          serviceId: { type: "string" },
          masterId: { type: "string" },
          slotStartAt: { type: "string" },
          clientName: { type: "string" }
        }
      }
    },
    {
      type: "function",
      name: "cancel_booking",
      description: "Cancel a booking that belongs to the current WhatsApp user.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId"],
        properties: {
          bookingId: { type: "string" }
        }
      }
    },
    {
      type: "function",
      name: "reschedule_booking",
      description: "Reschedule an existing booking after the new slot is known.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["bookingId", "serviceId", "slotStartAt"],
        properties: {
          bookingId: { type: "string" },
          serviceId: { type: "string" },
          masterId: { type: "string" },
          slotStartAt: { type: "string" }
        }
      }
    },
    {
      type: "function",
      name: "notify_admin_whatsapp_handoff",
      description: "Forward the request to the administrator via WhatsApp when human help is needed.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: {
          summary: { type: "string" }
        }
      }
    }
  ] as const;
}

async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: {
    locale: SupportedLocale;
    tenantConfig: TenantBotConfig;
    session: WhatsAppConversationSession;
    phone: string;
  },
  deps: AiOrchestratorDeps
): Promise<{ output: Record<string, unknown>; artifact: ToolArtifact; summary?: string }> {
  switch (toolName) {
    case "list_services": {
      const services = await deps.fetchServices(context.locale);
      const query = asOptionalString(args.query);
      const intent = asIntent(args.intent) ?? "new_booking";
      const matched = findMatches(services, query, (item) => item.displayName);
      if (query && matched.length === 1) {
        const picked = matched[0];
        if (!picked) {
          return {
            output: { ok: false, reason: "service_resolution_failed" },
            artifact: { kind: "none" },
            summary: "Service resolution failed."
          };
        }
        context.session.intent = intent;
        context.session.serviceId = picked.id;
        context.session.serviceName = picked.displayName;
        context.session.collectedEntities = {
          ...context.session.collectedEntities,
          serviceNameCandidate: picked.displayName
        };
        return {
          output: {
            ok: true,
            requiresSelection: false,
            service: {
              id: picked.id,
              displayName: picked.displayName
            }
          },
          artifact: { kind: "none" },
          summary: `Service resolved: ${picked.displayName}.`
        };
      }

      return {
        output: {
          ok: true,
          requiresSelection: true,
          items: services.slice(0, 8).map((item) => ({
            id: item.id,
            displayName: item.displayName,
            durationMinutes: item.durationMinutes ?? null
          }))
        },
        artifact: {
          kind: "service_list",
          prompt: context.locale === "it" ? "Seleziona il servizio." : "Select a service.",
          items: services.slice(0, 8),
          intent
        },
        summary: "Service selection needed."
      };
    }
    case "list_masters": {
      const query = asOptionalString(args.query);
      const serviceId = asOptionalString(args.serviceId) ?? context.session.serviceId;
      const serviceName = asOptionalString(args.serviceName) ?? context.session.serviceName;
      const intent = asIntent(args.intent) ?? context.session.intent ?? "new_booking";
      const masters = await deps.fetchMasters(context.locale, serviceId);
      const matched = findMatches(masters, query, (item) => item.displayName);
      if (query && matched.length === 1) {
        const picked = matched[0];
        if (!picked) {
          return {
            output: { ok: false, reason: "master_resolution_failed" },
            artifact: { kind: "none" },
            summary: "Master resolution failed."
          };
        }
        context.session.intent = intent;
        context.session.serviceId = serviceId;
        context.session.serviceName = serviceName;
        context.session.masterId = picked.id;
        context.session.masterName = picked.displayName;
        context.session.collectedEntities = {
          ...context.session.collectedEntities,
          masterNameCandidate: picked.displayName
        };
        return {
          output: {
            ok: true,
            requiresSelection: false,
            master: {
              id: picked.id,
              displayName: picked.displayName
            }
          },
          artifact: { kind: "none" },
          summary: `Master resolved: ${picked.displayName}.`
        };
      }

      return {
        output: {
          ok: true,
          requiresSelection: true,
          items: masters.slice(0, 8).map((item) => ({
            id: item.id,
            displayName: item.displayName
          }))
        },
        artifact: {
          kind: "master_list",
          prompt: context.locale === "it" ? "Scegli il master." : "Choose a master.",
          serviceId,
          serviceName,
          items: masters.slice(0, 8),
          intent
        },
        summary: "Master selection needed."
      };
    }
    case "list_dates_with_slots": {
      const serviceId = asOptionalString(args.serviceId) ?? context.session.serviceId;
      if (!serviceId) {
        return {
          output: { ok: false, reason: "missing_service_id" },
          artifact: { kind: "none" },
          summary: "Missing service for date listing."
        };
      }
      const serviceName = asOptionalString(args.serviceName) ?? context.session.serviceName;
      const masterId = asOptionalString(args.masterId) ?? context.session.masterId;
      const masterName = asOptionalString(args.masterName) ?? context.session.masterName;
      const intent = asIntent(args.intent) ?? context.session.intent ?? "new_booking";
      const dates = await listDatesWithSlots({
        locale: context.locale,
        timezone: context.tenantConfig.timezone,
        serviceId,
        masterId,
        days: asPositiveInt(args.days) ?? 7
      }, deps);

      return {
        output: {
          ok: true,
          requiresSelection: true,
          items: dates.map((item) => ({
            date: item.date,
            title: item.title,
            description: item.description ?? null
          }))
        },
        artifact: {
          kind: "date_list",
          prompt: context.locale === "it" ? "Scegli una data." : "Choose a date.",
          serviceId,
          serviceName,
          masterId,
          masterName,
          items: dates,
          intent
        },
        summary: "Date selection needed."
      };
    }
    case "list_slots": {
      const serviceId = asOptionalString(args.serviceId) ?? context.session.serviceId;
      const date = asOptionalString(args.date) ?? context.session.date;
      if (!serviceId || !date) {
        return {
          output: { ok: false, reason: "missing_service_or_date" },
          artifact: { kind: "none" },
          summary: "Missing service or date for slot listing."
        };
      }
      const serviceName = asOptionalString(args.serviceName) ?? context.session.serviceName;
      const masterId = asOptionalString(args.masterId) ?? context.session.masterId;
      const masterName = asOptionalString(args.masterName) ?? context.session.masterName;
      const intent = asIntent(args.intent) ?? context.session.intent ?? "new_booking";
      const slots = await deps.fetchSlots({
        serviceId,
        masterId,
        date,
        locale: context.locale
      });

      if (slots.length === 0) {
        const alternativeDates = await listDatesWithSlots({
          locale: context.locale,
          timezone: context.tenantConfig.timezone,
          serviceId,
          masterId,
          days: 7,
          excludedDate: date
        }, deps);
        return {
          output: {
            ok: true,
            requiresSelection: true,
            items: alternativeDates.map((item) => ({
              date: item.date,
              title: item.title,
              description: item.description ?? null
            }))
          },
          artifact: {
            kind: "date_list",
            prompt:
              context.locale === "it"
                ? "Per questa data non ci sono slot. Scegli un'altra data."
                : "There are no slots for this date. Please choose another date.",
            serviceId,
            serviceName,
            masterId,
            masterName,
            items: alternativeDates,
            intent
          },
          summary: "Alternative date selection needed."
        };
      }

      return {
        output: {
          ok: true,
          requiresSelection: true,
          items: slots.slice(0, 8).map((item) => ({
            startAt: item.startAt,
            displayTime: item.displayTime
          }))
        },
        artifact: {
          kind: "slot_list",
          prompt: context.locale === "it" ? "Scegli un orario." : "Choose a time.",
          serviceId,
          serviceName,
          masterId,
          masterName,
          date,
          items: slots.slice(0, 8),
          intent
        },
        summary: "Slot selection needed."
      };
    }
    case "list_user_bookings": {
      const action = args.action === "reschedule" ? "reschedule" : "cancel";
      const items = await deps.listBookingsByPhone({ phone: context.phone, limit: 10 });
      return {
        output: {
          ok: true,
          items: items.map((item) => ({
            id: item.id,
            startAt: item.startAt,
            status: item.status
          }))
        },
        artifact: {
          kind: "booking_list",
          prompt:
            action === "cancel"
              ? context.locale === "it"
                ? "Scegli la prenotazione da annullare."
                : "Choose the booking to cancel."
              : context.locale === "it"
                ? "Scegli la prenotazione da spostare."
                : "Choose the booking to reschedule.",
          action,
          items
        },
        summary: "Booking selection needed."
      };
    }
    case "create_booking_request": {
      const serviceId = asOptionalString(args.serviceId) ?? context.session.serviceId;
      const slotStartAt = asOptionalString(args.slotStartAt) ?? context.session.slotStartAt;
      if (!serviceId || !slotStartAt) {
        return {
          output: { ok: false, reason: "missing_booking_fields" },
          artifact: { kind: "none" },
          summary: "Booking creation blocked by missing fields."
        };
      }
      const bookingId = await deps.createBooking({
        serviceId,
        masterId: asOptionalString(args.masterId) ?? context.session.masterId,
        startAtIso: slotStartAt,
        phone: context.phone,
        locale: context.locale,
        clientName: asOptionalString(args.clientName) ?? "WhatsApp Client"
      });
      context.session.bookingIdInContext = bookingId;
      return {
        output: { ok: true, bookingId, status: "pending" },
        artifact: { kind: "none" },
        summary: "Booking request created."
      };
    }
    case "cancel_booking": {
      const bookingId = asOptionalString(args.bookingId) ?? context.session.bookingIdInContext;
      if (!bookingId) {
        return {
          output: { ok: false, reason: "missing_booking_id" },
          artifact: { kind: "none" },
          summary: "Booking cancel blocked by missing booking id."
        };
      }
      await deps.cancelBooking({ bookingId, phone: context.phone });
      context.session.bookingIdInContext = bookingId;
      return {
        output: { ok: true, bookingId, status: "cancelled" },
        artifact: { kind: "none" },
        summary: "Booking cancelled."
      };
    }
    case "reschedule_booking": {
      const bookingId =
        asOptionalString(args.bookingId) ?? context.session.bookingIdToReschedule ?? context.session.bookingIdInContext;
      const serviceId = asOptionalString(args.serviceId) ?? context.session.serviceId;
      const slotStartAt = asOptionalString(args.slotStartAt) ?? context.session.slotStartAt;
      if (!bookingId || !serviceId || !slotStartAt) {
        return {
          output: { ok: false, reason: "missing_reschedule_fields" },
          artifact: { kind: "none" },
          summary: "Booking reschedule blocked by missing fields."
        };
      }
      const newBookingId = await deps.rescheduleBooking({
        bookingId,
        phone: context.phone,
        serviceId,
        masterId: asOptionalString(args.masterId) ?? context.session.masterId,
        startAtIso: slotStartAt,
        locale: context.locale
      });
      context.session.bookingIdInContext = newBookingId;
      return {
        output: { ok: true, bookingId: newBookingId, status: "pending" },
        artifact: { kind: "none" },
        summary: "Booking rescheduled."
      };
    }
    case "notify_admin_whatsapp_handoff": {
      const summary = asOptionalString(args.summary) ?? "User requested human assistance.";
      const notified = await deps.notifyAdminHandoff({
        phone: context.phone,
        summary,
        locale: context.locale
      });
      return {
        output: { ok: notified, status: notified ? "notified" : "skipped" },
        artifact: {
          kind: "handoff",
          prompt:
            context.locale === "it"
              ? "La richiesta e stata inoltrata all'amministratore."
              : "The request has been forwarded to the administrator.",
          summary,
          notified
        },
        summary: "Human handoff requested."
      };
    }
    default:
      throw new Error(`unsupported_tool:${toolName}`);
  }
}

async function renderArtifact(
  input: {
    from: string;
    locale: SupportedLocale;
    session: WhatsAppConversationSession;
    artifact: ToolArtifact;
  },
  deps: AiOrchestratorDeps
) {
  switch (input.artifact.kind) {
    case "service_list": {
      if (input.artifact.items.length === 0) {
        await deps.sendText(
          input.from,
          input.locale === "it" ? "Al momento non ci sono servizi disponibili." : "No services are currently available."
        );
        return;
      }
      input.session.currentMode = "ai_assisted";
      input.session.intent = input.artifact.intent ?? input.session.intent ?? "new_booking";
      input.session.state = "choose_service";
      await deps.saveSession(input.from, input.session);
      await deps.sendList(
        input.from,
        input.artifact.prompt,
        input.locale === "it" ? "Servizi" : "Services",
        appendFlowRows(
          input.artifact.items.map((item) => ({
            id: `service:${item.id}`,
            title: truncate(item.displayName, 24),
            description:
              typeof item.durationMinutes === "number" ? `${item.durationMinutes} min` : undefined
          })),
          input.locale
        )
      );
      return;
    }
    case "master_list": {
      if (input.artifact.items.length === 0) {
        await deps.sendText(
          input.from,
          input.locale === "it" ? "Nessun master disponibile." : "No masters are available."
        );
        return;
      }
      input.session.currentMode = "ai_assisted";
      input.session.intent = input.artifact.intent ?? input.session.intent ?? "new_booking";
      input.session.serviceId = input.artifact.serviceId ?? input.session.serviceId;
      input.session.serviceName = input.artifact.serviceName ?? input.session.serviceName;
      input.session.state = "choose_master";
      await deps.saveSession(input.from, input.session);
      await deps.sendList(
        input.from,
        input.artifact.prompt,
        input.locale === "it" ? "Master" : "Masters",
        appendFlowRows(
          input.artifact.items.map((item) => ({
            id: `master:${item.id}`,
            title: truncate(item.displayName, 24)
          })),
          input.locale
        )
      );
      return;
    }
    case "date_list": {
      if (input.artifact.items.length === 0) {
        await deps.sendText(
          input.from,
          input.locale === "it"
            ? "Non ci sono date disponibili al momento."
            : "There are no available dates right now."
        );
        return;
      }
      input.session.currentMode = "ai_assisted";
      input.session.intent = input.artifact.intent ?? input.session.intent ?? "new_booking";
      input.session.serviceId = input.artifact.serviceId ?? input.session.serviceId;
      input.session.serviceName = input.artifact.serviceName ?? input.session.serviceName;
      input.session.masterId = input.artifact.masterId ?? input.session.masterId;
      input.session.masterName = input.artifact.masterName ?? input.session.masterName;
      input.session.state = "choose_date";
      await deps.saveSession(input.from, input.session);
      await deps.sendList(
        input.from,
        input.artifact.prompt,
        input.locale === "it" ? "Date" : "Dates",
        appendFlowRows(
          input.artifact.items.map((item) => ({
            id: `date:${item.date}`,
            title: truncate(item.title, 24),
            description: item.description
          })),
          input.locale
        )
      );
      return;
    }
    case "slot_list": {
      if (input.artifact.items.length === 0) {
        await deps.sendText(
          input.from,
          input.locale === "it" ? "Non ci sono orari disponibili." : "There are no available times."
        );
        return;
      }
      input.session.currentMode = "ai_assisted";
      input.session.intent = input.artifact.intent ?? input.session.intent ?? "new_booking";
      input.session.serviceId = input.artifact.serviceId ?? input.session.serviceId;
      input.session.serviceName = input.artifact.serviceName ?? input.session.serviceName;
      input.session.masterId = input.artifact.masterId ?? input.session.masterId;
      input.session.masterName = input.artifact.masterName ?? input.session.masterName;
      input.session.date = input.artifact.date;
      input.session.state = "choose_slot";
      await deps.saveSession(input.from, input.session);
      await deps.sendList(
        input.from,
        input.artifact.prompt,
        input.locale === "it" ? "Orari" : "Times",
        appendFlowRows(
          input.artifact.items.map((item) => ({
            id: `slot:${encodeURIComponent(item.startAt)}`,
            title: truncate(item.displayTime, 24)
          })),
          input.locale
        )
      );
      return;
    }
    case "booking_list": {
      if (input.artifact.items.length === 0) {
        await deps.sendText(
          input.from,
          input.locale === "it"
            ? "Non ci sono prenotazioni attive da gestire."
            : "There are no active bookings to manage."
        );
        return;
      }
      input.session.currentMode = "ai_assisted";
      input.session.intent =
        input.artifact.action === "cancel" ? "cancel_booking" : "reschedule_booking";
      input.session.state =
        input.artifact.action === "cancel" ? "cancel_wait_booking_id" : "reschedule_wait_booking_id";
      await deps.saveSession(input.from, input.session);
      await deps.sendList(
        input.from,
        input.artifact.prompt,
        input.locale === "it" ? "Prenotazioni" : "Bookings",
        appendFlowRows(
          input.artifact.items.map((item) => ({
            id: `booking:${item.id}`,
            title: truncate(formatBookingChoice(item.startAt, input.locale), 24),
            description: item.status
          })),
          input.locale
        )
      );
      return;
    }
    case "handoff": {
      input.session.currentMode = "human_handoff";
      input.session.handoffStatus = input.artifact.notified ? "active" : "pending";
      input.session.lastAiSummary = input.artifact.summary;
      await deps.saveSession(input.from, input.session);
      await deps.sendText(input.from, input.artifact.prompt);
      return;
    }
    case "none":
      return;
  }
}

async function listDatesWithSlots(
  input: {
    locale: SupportedLocale;
    timezone: string;
    serviceId: string;
    masterId?: string;
    days: number;
    excludedDate?: string;
  },
  deps: AiOrchestratorDeps
) {
  const dates = buildNextDays(input.timezone, Math.min(Math.max(input.days, 1), 10));
  const items: Array<{ date: string; title: string; description?: string }> = [];
  for (const date of dates) {
    if (date === input.excludedDate) {
      continue;
    }
    const slots = await deps.fetchSlots({
      serviceId: input.serviceId,
      masterId: input.masterId,
      date,
      locale: input.locale
    });
    if (slots.length === 0) {
      continue;
    }
    items.push({
      date,
      title: formatDateLabel(date, input.locale, input.timezone),
      description:
        input.locale === "it" ? `${slots.length} slot disponibili` : `${slots.length} slots available`
    });
  }
  return items.slice(0, 8);
}

function buildNextDays(timezone: string, count: number) {
  const out: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(Date.now() + index * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find((item) => item.type === "year")?.value;
    const month = parts.find((item) => item.type === "month")?.value;
    const day = parts.find((item) => item.type === "day")?.value;
    if (year && month && day) {
      out.push(`${year}-${month}-${day}`);
    }
  }
  return Array.from(new Set(out));
}

function formatDateLabel(dateIso: string, locale: SupportedLocale, timezone: string) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone
  }).format(new Date(`${dateIso}T00:00:00.000Z`));
}

function formatBookingChoice(startAtIso: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(startAtIso));
}

function findMatches<T>(items: T[], query: string | undefined, readLabel: (item: T) => string) {
  if (!query?.trim()) {
    return [];
  }
  const normalized = normalizeSearch(query);
  return items.filter((item) => normalizeSearch(readLabel(item)).includes(normalized));
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function appendFlowRows(choices: Choice[], locale: SupportedLocale) {
  return [
    ...choices.slice(0, 8),
    {
      id: BACK_FLOW_TOKEN,
      title: locale === "it" ? "Indietro" : "Back"
    },
    {
      id: RESTART_FLOW_TOKEN,
      title: locale === "it" ? "Inizio" : "Start over"
    }
  ].slice(0, 10);
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function sanitizeUserText(value: string) {
  return value
    .replace(/\b(?:code|codice)\b\s*:\s*[^\n]+/gi, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPositiveInt(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function safeJsonParse(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function asIntent(value: unknown): ConversationIntent | undefined {
  if (value === "new_booking" || value === "cancel_booking" || value === "reschedule_booking") {
    return value;
  }
  return undefined;
}

function detectMessageLocale(
  text: string,
  sessionLocale: SupportedLocale,
  tenantDefaultLocale: SupportedLocale
): SupportedLocale {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return sessionLocale ?? tenantDefaultLocale;
  }

  if (
    /\b(ciao|salve|buongiorno|buonasera|vorrei|prenotazione|prenotare|annulla|sposta|domani|oggi|sera|servizio|servizi|orario|orari|operatore|umano|grazie|per favore|disponibilita)\b/.test(
      normalized
    )
  ) {
    return "it";
  }

  if (
    /\b(hello|hi|hey|booking|book|cancel|reschedule|service|services|tomorrow|today|evening|time|times|operator|human|please|thanks|thank you|availability|available|need|want|schedule)\b/.test(
      normalized
    )
  ) {
    return "en";
  }

  const asciiLetters = normalized.replace(/[^a-z]/g, "");
  if (asciiLetters.length >= 6 && /^[\x00-\x7F\s\d.,!?':;"()/-]+$/.test(normalized)) {
    return "en";
  }

  return sessionLocale ?? tenantDefaultLocale;
}

function classifyAiError(error: unknown) {
  if (error instanceof OpenAIResponsesError) {
    if (error.code === "openai_tool_chain_invalid" || error.code === "openai_previous_response_not_found") {
      return "openai_chain_error";
    }
    return "openai_transport_error";
  }

  if (error instanceof Error && error.message.startsWith("unsupported_tool:")) {
    return "tool_schema_error";
  }

  return "tool_domain_error";
}

function maskPhone(value: string): string {
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length <= 4) {
    return "***";
  }
  return `${normalized.slice(0, 3)}***${normalized.slice(-2)}`;
}
