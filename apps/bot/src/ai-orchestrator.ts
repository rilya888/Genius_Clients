import { randomUUID } from "node:crypto";
import type { SupportedLocale } from "@genius/i18n";
import { createInitialSession, type ConversationIntent, type WhatsAppConversationSession } from "./whatsapp-conversation";
import { OPENAI_PROMPT_VERSION, buildBookingParserInput, buildBookingParserInstructions } from "./openai-prompts";
import { OpenAIResponsesClient, OpenAIResponsesError } from "./openai-responses-client";

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

type ParsedIntent =
  | ConversationIntent
  | "catalog"
  | "check_availability"
  | "human_handoff"
  | "unknown";

type AiParseResult = {
  intent: ParsedIntent;
  confidence: "high" | "medium" | "low";
  serviceQuery?: string;
  masterQuery?: string;
  dateText?: string;
  timeText?: string;
  bookingReference?: string;
  replyText?: string;
  handoffSummary?: string;
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
  | {
      kind: "confirm_booking";
      serviceName?: string;
      masterName?: string;
      date?: string;
      slotDisplayTime?: string;
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
  const session = (await deps.loadSession(input.from)) ?? createInitialSession(detectedLocale);
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
    const parsed = await parseUserMessage(
      {
        client,
        model: tenantConfig.openaiModel || input.globalModel,
        locale: detectedLocale,
        tenantConfig,
        session,
        userText: input.text,
        traceId
      }
    );

    console.info("[bot][ai] parsed", {
      traceId,
      intent: parsed.intent,
      confidence: parsed.confidence,
      hasServiceQuery: Boolean(parsed.serviceQuery),
      hasMasterQuery: Boolean(parsed.masterQuery),
      hasDateText: Boolean(parsed.dateText),
      hasTimeText: Boolean(parsed.timeText),
      hasBookingReference: Boolean(parsed.bookingReference)
    });

    const result = await resolveAiPlan(
      {
        locale: detectedLocale,
        tenantConfig,
        session,
        parsed,
        phone: input.from,
        traceId
      },
      deps
    );

    session.lastOpenaiResponseId = undefined;
    session.lastAiSummary = buildSessionSummary(session, parsed);
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
        mode: "text"
      });
      return { handled: true };
    }

    return { handled: false };
  } catch (error) {
    const errorClass = classifyAiError(error);
    session.aiFailureCount = (session.aiFailureCount ?? 0) + 1;
    session.currentMode = "deterministic";
    session.lastOpenaiResponseId = undefined;
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

async function parseUserMessage(input: {
  client: OpenAIResponsesClient;
  model: string;
  locale: SupportedLocale;
  tenantConfig: TenantBotConfig;
  session: WhatsAppConversationSession;
  userText: string;
  traceId: string;
}): Promise<AiParseResult> {
  const response = await input.client.create({
    model: input.model,
    instructions: buildBookingParserInstructions({
      locale: input.locale,
      tenantName: input.tenantConfig.name,
      tenantTimezone: input.tenantConfig.timezone,
      session: input.session
    }),
    input: buildBookingParserInput({
      locale: input.locale,
      userText: input.userText,
      session: input.session
    }),
    turnType: "user_input",
    metadata: {
      trace_id: input.traceId,
      prompt_version: OPENAI_PROMPT_VERSION,
      locale: input.locale
    }
  });

  const payload = extractJsonObject(response.outputText);
  if (!payload) {
    throw new Error("ai_parse_invalid_json");
  }

  return normalizeAiParseResult(payload, input.locale);
}

async function resolveAiPlan(
  input: {
    locale: SupportedLocale;
    tenantConfig: TenantBotConfig;
    session: WhatsAppConversationSession;
    parsed: AiParseResult;
    phone: string;
    traceId: string;
  },
  deps: AiOrchestratorDeps
): Promise<{ artifact: ToolArtifact; outputText?: string }> {
  switch (input.parsed.intent) {
    case "human_handoff": {
      const summary =
        input.parsed.handoffSummary?.trim() || input.parsed.replyText?.trim() || input.parsed.serviceQuery?.trim() || "Human assistance requested.";
      const notified = await deps.notifyAdminHandoff({
        phone: input.phone,
        summary,
        locale: input.locale
      });
      return {
        artifact: {
          kind: "handoff",
          prompt:
            input.locale === "it"
              ? "La richiesta e stata inoltrata all'amministratore."
              : "The request has been forwarded to the administrator.",
          summary,
          notified
        }
      };
    }

    case "cancel_booking": {
      const items = await deps.listBookingsByPhone({ phone: input.phone, limit: 10 });
      return {
        artifact: {
          kind: "booking_list",
          prompt:
            input.locale === "it"
              ? "Scegli la prenotazione da annullare."
              : "Choose the booking to cancel.",
          action: "cancel",
          items
        }
      };
    }

    case "reschedule_booking": {
      const items = await deps.listBookingsByPhone({ phone: input.phone, limit: 10 });
      return {
        artifact: {
          kind: "booking_list",
          prompt:
            input.locale === "it"
              ? "Scegli la prenotazione da spostare."
              : "Choose the booking to reschedule.",
          action: "reschedule",
          items
        }
      };
    }

    case "catalog":
    case "check_availability":
    case "new_booking": {
      return resolveBookingLikeIntent(input, deps);
    }

    case "unknown": {
      return {
        artifact: { kind: "none" },
        outputText:
          input.parsed.replyText ||
          (input.locale === "it"
            ? "Posso aiutarti con prenotazioni, annullamenti e spostamenti."
            : "I can help with bookings, cancellations, and rescheduling.")
      };
    }
  }
}

async function resolveBookingLikeIntent(
  input: {
    locale: SupportedLocale;
    tenantConfig: TenantBotConfig;
    session: WhatsAppConversationSession;
    parsed: AiParseResult;
    phone: string;
    traceId: string;
  },
  deps: AiOrchestratorDeps
): Promise<{ artifact: ToolArtifact; outputText?: string }> {
  input.session.intent = input.parsed.intent === "new_booking" || input.parsed.intent === "check_availability" ? "new_booking" : "new_booking";

  const services = await deps.fetchServices(input.locale);
  const serviceResolution = resolveNamedChoice(services, input.parsed.serviceQuery, (item) => item.displayName);
  if (!input.parsed.serviceQuery) {
    return {
      artifact: {
        kind: "service_list",
        prompt: input.locale === "it" ? "Seleziona il servizio." : "Select a service.",
        items: services.slice(0, 8),
        intent: "new_booking"
      }
    };
  }
  if (serviceResolution.matches.length !== 1) {
    return {
      artifact: {
        kind: "service_list",
        prompt:
          input.locale === "it"
            ? "Ho trovato piu servizi. Scegline uno."
            : "I found multiple services. Please choose one.",
        items: (serviceResolution.matches.length > 0 ? serviceResolution.matches : services).slice(0, 8),
        intent: "new_booking"
      }
    };
  }

  const service = serviceResolution.matches[0] as ServiceItem;
  input.session.serviceId = service.id;
  input.session.serviceName = service.displayName;
  input.session.collectedEntities = {
    ...input.session.collectedEntities,
    serviceNameCandidate: input.parsed.serviceQuery
  };

  const masters = await deps.fetchMasters(input.locale, service.id);
  const masterResolution = resolveNamedChoice(masters, input.parsed.masterQuery, (item) => item.displayName);
  if (!input.parsed.masterQuery) {
    if (masters.length === 1) {
      input.session.masterId = masters[0]?.id;
      input.session.masterName = masters[0]?.displayName;
    } else {
      return {
        artifact: {
          kind: "master_list",
          prompt: input.locale === "it" ? "Scegli il master." : "Choose a master.",
          serviceId: service.id,
          serviceName: service.displayName,
          items: masters.slice(0, 8),
          intent: "new_booking"
        }
      };
    }
  } else if (masterResolution.matches.length !== 1) {
    return {
      artifact: {
        kind: "master_list",
        prompt:
          input.locale === "it"
            ? "Ho trovato piu master. Scegline uno."
            : "I found multiple masters. Please choose one.",
        serviceId: service.id,
        serviceName: service.displayName,
        items: (masterResolution.matches.length > 0 ? masterResolution.matches : masters).slice(0, 8),
        intent: "new_booking"
      }
    };
  } else {
    const master = masterResolution.matches[0] as MasterItem;
    input.session.masterId = master.id;
    input.session.masterName = master.displayName;
    input.session.collectedEntities = {
      ...input.session.collectedEntities,
      masterNameCandidate: input.parsed.masterQuery
    };
  }

  const dateIso = normalizeDateCandidate(input.parsed.dateText, input.locale, input.tenantConfig.timezone);
  if (!dateIso) {
    const dates = await listDatesWithSlots(
      {
        locale: input.locale,
        timezone: input.tenantConfig.timezone,
        serviceId: service.id,
        masterId: input.session.masterId,
        days: 7
      },
      deps
    );
    return {
      artifact: {
        kind: "date_list",
        prompt: input.locale === "it" ? "Scegli una data." : "Choose a date.",
        serviceId: service.id,
        serviceName: service.displayName,
        masterId: input.session.masterId,
        masterName: input.session.masterName,
        items: dates,
        intent: "new_booking"
      }
    };
  }

  input.session.date = dateIso;
  input.session.collectedEntities = {
    ...input.session.collectedEntities,
    dateCandidate: input.parsed.dateText
  };

  const slots = await deps.fetchSlots({
    serviceId: service.id,
    masterId: input.session.masterId,
    date: dateIso,
    locale: input.locale
  });

  if (slots.length === 0) {
    const alternativeDates = await listDatesWithSlots(
      {
        locale: input.locale,
        timezone: input.tenantConfig.timezone,
        serviceId: service.id,
        masterId: input.session.masterId,
        days: 7,
        excludedDate: dateIso
      },
      deps
    );
    return {
      artifact: {
        kind: "date_list",
        prompt:
          input.locale === "it"
            ? "Per questa data non ci sono slot. Scegli un'altra data."
            : "There are no slots for this date. Please choose another date.",
        serviceId: service.id,
        serviceName: service.displayName,
        masterId: input.session.masterId,
        masterName: input.session.masterName,
        items: alternativeDates,
        intent: "new_booking"
      }
    };
  }

  const slotResolution = resolveSlotChoice(slots, input.parsed.timeText);
  if (!input.parsed.timeText || slotResolution.matches.length !== 1) {
    return {
      artifact: {
        kind: "slot_list",
        prompt: input.locale === "it" ? "Scegli un orario." : "Choose a time.",
        serviceId: service.id,
        serviceName: service.displayName,
        masterId: input.session.masterId,
        masterName: input.session.masterName,
        date: dateIso,
        items: (slotResolution.matches.length > 0 ? slotResolution.matches : slots).slice(0, 8),
        intent: "new_booking"
      }
    };
  }

  const slot = slotResolution.matches[0] as SlotItem;
  input.session.slotStartAt = slot.startAt;
  input.session.slotDisplayTime = slot.displayTime;
  input.session.state = "confirm";
  input.session.currentMode = "ai_assisted";
  input.session.collectedEntities = {
    ...input.session.collectedEntities,
    timeCandidate: input.parsed.timeText
  };

  return {
    artifact: {
      kind: "confirm_booking",
      serviceName: input.session.serviceName,
      masterName: input.session.masterName,
      date: input.session.date,
      slotDisplayTime: input.session.slotDisplayTime
    }
  };
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
            description: typeof item.durationMinutes === "number" ? `${item.durationMinutes} min` : undefined
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
      input.session.intent = input.artifact.action === "cancel" ? "cancel_booking" : "reschedule_booking";
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
    case "confirm_booking": {
      input.session.currentMode = "ai_assisted";
      input.session.state = "confirm";
      await deps.saveSession(input.from, input.session);
      const summary =
        input.locale === "it"
          ? `Confermi prenotazione?\nServizio: ${input.artifact.serviceName ?? "-"}\nMaster: ${input.artifact.masterName ?? "-"}\nData: ${input.artifact.date ?? "-"}\nOrario: ${input.artifact.slotDisplayTime ?? "-"}`
          : `Confirm booking?\nService: ${input.artifact.serviceName ?? "-"}\nMaster: ${input.artifact.masterName ?? "-"}\nDate: ${input.artifact.date ?? "-"}\nTime: ${input.artifact.slotDisplayTime ?? "-"}`;
      await deps.sendList(input.from, summary, input.locale === "it" ? "Conferma" : "Confirm", [
        {
          id: "confirm:yes",
          title: input.locale === "it" ? "Conferma" : "Confirm"
        },
        {
          id: "confirm:change",
          title: input.locale === "it" ? "Cambia data" : "Change date"
        },
        {
          id: "confirm:cancel",
          title: input.locale === "it" ? "Annulla" : "Cancel"
        },
        {
          id: BACK_FLOW_TOKEN,
          title: input.locale === "it" ? "Indietro" : "Back"
        },
        {
          id: RESTART_FLOW_TOKEN,
          title: input.locale === "it" ? "Inizio" : "Start over"
        }
      ].slice(0, 10));
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
      description: input.locale === "it" ? `${slots.length} slot disponibili` : `${slots.length} slots available`
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

function resolveNamedChoice<T>(items: T[], query: string | undefined, readLabel: (item: T) => string) {
  if (!query?.trim()) {
    return { matches: [] as T[] };
  }
  return {
    matches: findMatches(items, query, readLabel)
  };
}

function findMatches<T>(items: T[], query: string | undefined, readLabel: (item: T) => string) {
  if (!query?.trim()) {
    return [];
  }
  const normalized = normalizeSearch(query);
  const exact = items.filter((item) => normalizeSearch(readLabel(item)) === normalized);
  if (exact.length > 0) {
    return exact;
  }
  return items.filter((item) => normalizeSearch(readLabel(item)).includes(normalized));
}

function resolveSlotChoice(slots: SlotItem[], timeText: string | undefined) {
  if (!timeText?.trim()) {
    return { matches: [] as SlotItem[] };
  }
  const normalizedTime = normalizeTimeCandidate(timeText);
  if (!normalizedTime) {
    return { matches: [] as SlotItem[] };
  }
  const exact = slots.filter((item) => normalizeTimeCandidate(item.displayTime) === normalizedTime);
  if (exact.length > 0) {
    return { matches: exact };
  }
  return {
    matches: slots.filter((item) => normalizeSearch(item.displayTime).includes(normalizedTime))
  };
}

function normalizeDateCandidate(
  value: string | undefined,
  locale: SupportedLocale,
  timezone: string
): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const normalized = normalizeSearch(value);
  const nextDays = buildNextDays(timezone, 14);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  if (normalized === "today" || normalized === "oggi") {
    return nextDays[0];
  }
  if (normalized === "tomorrow" || normalized === "domani") {
    return nextDays[1];
  }
  const weekdayIndex = mapWeekday(normalized, locale);
  if (weekdayIndex === undefined) {
    return undefined;
  }
  return nextDays.find((date) => getWeekdayIndex(date, timezone) === weekdayIndex);
}

function mapWeekday(value: string, locale: SupportedLocale) {
  const enMap: Record<string, number> = {
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
    sunday: 0,
    sun: 0
  };
  const itMap: Record<string, number> = {
    lunedi: 1,
    lun: 1,
    martedi: 2,
    mar: 2,
    mercoledi: 3,
    mer: 3,
    giovedi: 4,
    gio: 4,
    venerdi: 5,
    ven: 5,
    sabato: 6,
    sab: 6,
    domenica: 0,
    dom: 0
  };
  return locale === "it" ? itMap[value] : enMap[value];
}

function getWeekdayIndex(dateIso: string, timezone: string) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: timezone
  }).format(new Date(`${dateIso}T00:00:00.000Z`));
  return mapWeekday(weekday.toLowerCase(), "en");
}

function normalizeTimeCandidate(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?/);
  if (!match) {
    return undefined;
  }
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "00");
  const suffix = match[3];
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59) {
    return undefined;
  }
  if (suffix === "pm" && hours < 12) {
    hours += 12;
  }
  if (suffix === "am" && hours === 12) {
    hours = 0;
  }
  if (hours > 23) {
    return undefined;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  const direct = safeJsonParse(trimmed);
  if (direct) {
    return direct;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return safeJsonParse(trimmed.slice(start, end + 1));
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeAiParseResult(payload: Record<string, unknown>, locale: SupportedLocale): AiParseResult {
  const rawIntent = asOptionalString(payload.intent) ?? "unknown";
  const rawConfidence = asOptionalString(payload.confidence) ?? "low";
  return {
    intent: isParsedIntent(rawIntent) ? rawIntent : "unknown",
    confidence: rawConfidence === "high" || rawConfidence === "medium" ? rawConfidence : "low",
    serviceQuery: asOptionalString(payload.service_query),
    masterQuery: asOptionalString(payload.master_query),
    dateText: asOptionalString(payload.date_text),
    timeText: asOptionalString(payload.time_text),
    bookingReference: asOptionalString(payload.booking_reference),
    replyText:
      asOptionalString(payload.reply_text) ||
      (locale === "it" ? "Posso aiutarti con prenotazioni, annullamenti e spostamenti." : "I can help with bookings, cancellations, and rescheduling."),
    handoffSummary: asOptionalString(payload.handoff_summary)
  };
}

function isParsedIntent(value: string): value is ParsedIntent {
  return ["new_booking", "cancel_booking", "reschedule_booking", "catalog", "check_availability", "human_handoff", "unknown"].includes(value);
}

function buildSessionSummary(session: WhatsAppConversationSession, parsed: AiParseResult) {
  return [
    `intent=${parsed.intent}`,
    `service=${session.serviceName ?? parsed.serviceQuery ?? "none"}`,
    `master=${session.masterName ?? parsed.masterQuery ?? "none"}`,
    `date=${session.date ?? parsed.dateText ?? "none"}`,
    `time=${session.slotDisplayTime ?? parsed.timeText ?? "none"}`
  ].join("; ").slice(0, 280);
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
    return "openai_transport_error";
  }
  if (error instanceof Error && error.message === "ai_parse_invalid_json") {
    return "ai_parse_error";
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
