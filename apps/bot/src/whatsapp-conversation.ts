import type { SupportedLocale } from "@genius/i18n";

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

export type ConversationState =
  | "choose_intent"
  | "choose_service"
  | "choose_master"
  | "choose_date"
  | "choose_slot"
  | "collect_client_name"
  | "confirm"
  | "cancel_wait_booking_id"
  | "reschedule_wait_booking_id";

export type ConversationIntent = "new_booking" | "cancel_booking" | "reschedule_booking";
export type ParsedConversationIntent =
  | ConversationIntent
  | "catalog"
  | "check_availability"
  | "human_handoff"
  | "unknown";
export type ConversationMode = "deterministic" | "ai_assisted" | "human_handoff";
export type ConversationHandoffStatus = "inactive" | "pending" | "active";
export type ConversationResetReason =
  | "explicit_reset_command"
  | "intent_conflict"
  | "idle_timeout"
  | "non_continuation_message"
  | "handoff_restart";

export type WhatsAppConversationSession = {
  flowVersion: number;
  locale: SupportedLocale;
  state: ConversationState;
  currentMode?: ConversationMode;
  intent?: ConversationIntent;
  serviceId?: string;
  serviceName?: string;
  masterId?: string;
  masterName?: string;
  date?: string;
  servicePage?: number;
  masterPage?: number;
  datePage?: number;
  bookingPage?: number;
  slotPage?: number;
  slotStartAt?: string;
  slotDisplayTime?: string;
  clientName?: string;
  bookingIdToReschedule?: string;
  bookingIdInContext?: string;
  collectedEntities?: {
    serviceNameCandidate?: string;
    masterNameCandidate?: string;
    dateCandidate?: string;
    timeCandidate?: string;
    timeRangeCandidate?: string;
    bookingReferenceCandidate?: string;
  };
  lastAiSummary?: string;
  lastOpenaiResponseId?: string;
  handoffStatus?: ConversationHandoffStatus;
  lastUserMessageAt?: string;
  aiFailureCount?: number;
  unknownTurnCount?: number;
  aiCallsInSession?: number;
  lastResolvedIntent?: ParsedConversationIntent;
  conversationTraceId?: string;
  lastResetAt?: string;
  lastResetReason?: ConversationResetReason;
};

type ConversationInput = {
  messageId: string;
  from: string;
  locale: SupportedLocale;
  text?: string;
  replyId?: string;
};

type Choice = {
  id: string;
  title: string;
  description?: string;
};

type FlowCtaAction = "flow_confirm_booking" | "flow_confirm_cancel";
type BookingSelectionUiMode = "none" | "buttons" | "list";

export type WhatsAppConversationDeps = {
  dedupInboundMessage: (messageId: string) => Promise<boolean>;
  loadSession: (phone: string) => Promise<WhatsAppConversationSession | null>;
  saveSession: (phone: string, session: WhatsAppConversationSession) => Promise<void>;
  clearSession: (phone: string) => Promise<void>;
  sendText: (to: string, text: string) => Promise<void>;
  sendList: (to: string, bodyText: string, buttonText: string, choices: Choice[]) => Promise<void>;
  sendButtons: (to: string, bodyText: string, choices: Choice[]) => Promise<void>;
  createFlowCtaAction?: (input: {
    action: FlowCtaAction;
    bookingId: string;
    phone: string;
    ttlMinutes?: number;
  }) => string | undefined;
  fetchServices: (locale: SupportedLocale) => Promise<ServiceItem[]>;
  fetchMasters: (locale: SupportedLocale, serviceId?: string) => Promise<MasterItem[]>;
  fetchSlots: (input: {
    serviceId: string;
    masterId?: string;
    date: string;
    locale: SupportedLocale;
  }) => Promise<SlotItem[]>;
  listBookingsByPhone: (input: {
    phone: string;
    limit?: number;
  }) => Promise<BookingItem[]>;
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
  getTenantTimezone: () => Promise<string>;
};

const FLOW_VERSION = 1;
const RESTART_FLOW_TOKEN = "flow:restart";
const BACK_FLOW_TOKEN = "flow:back";
const BOOKING_SELECTION_BUTTONS_MAX_ITEMS = 2;

function truncateForChoice(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function createInitialSession(locale: SupportedLocale): WhatsAppConversationSession {
  return {
    flowVersion: FLOW_VERSION,
    locale,
    state: "choose_intent",
    currentMode: "deterministic",
    servicePage: 0,
    masterPage: 0,
    datePage: 0,
    bookingPage: 0,
    slotPage: 0,
    handoffStatus: "inactive",
    aiFailureCount: 0
  };
}

export function resetSessionForNewConversation(input: {
  locale: SupportedLocale;
  nowIso: string;
  reason: ConversationResetReason;
}): WhatsAppConversationSession {
  return {
    ...createInitialSession(input.locale),
    lastUserMessageAt: input.nowIso,
    lastResetAt: input.nowIso,
    lastResetReason: input.reason
  };
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

function normalizeToken(input: ConversationInput): string {
  const preferred = input.replyId?.trim();
  if (preferred) {
    return preferred;
  }
  return input.text?.trim() ?? "";
}

function formatDateLabel(dateIso: string, locale: SupportedLocale, timezone: string): string {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone
  }).format(new Date(`${dateIso}T00:00:00.000Z`));
}

function formatDateTimeLabel(dateIso: string, locale: SupportedLocale, timezone: string): string {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone
  }).format(new Date(dateIso));
}

function buildNext7Days(timezone: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(date)
      .reduce(
        (acc, part) => {
          if (part.type === "year" || part.type === "month" || part.type === "day") {
            acc[part.type] = part.value;
          }
          return acc;
        },
        {} as Record<string, string>
      );
    if (parts.year && parts.month && parts.day) {
      out.push(`${parts.year}-${parts.month}-${parts.day}`);
    }
  }
  return Array.from(new Set(out));
}

function buildRestartChoice(locale: SupportedLocale): Choice {
  return {
    id: RESTART_FLOW_TOKEN,
    title: locale === "it" ? "Inizio" : "Start over"
  };
}

function buildPaginatedList<T>(input: {
  items: T[];
  page: number;
  mapChoice: (item: T) => Choice;
  navPrefix: string;
  locale: SupportedLocale;
}) {
  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(input.items.length / pageSize));
  const safePage = Math.min(Math.max(input.page, 0), totalPages - 1);
  const startIndex = safePage * pageSize;
  const pageItems = input.items.slice(startIndex, startIndex + pageSize);
  const choices: Choice[] = pageItems.map(input.mapChoice);

  if (totalPages > 1) {
    if (safePage > 0) {
      choices.push({
        id: `${input.navPrefix}:prev`,
        title: input.locale === "it" ? "Indietro" : "Previous"
      });
    }
    if (safePage < totalPages - 1) {
      choices.push({
        id: `${input.navPrefix}:next`,
        title: input.locale === "it" ? "Avanti" : "Next"
      });
    }
  }

  return { choices: choices.slice(0, 10), safePage, totalPages };
}

function appendFlowRows(input: { choices: Choice[]; locale: SupportedLocale }): Choice[] {
  return [
    ...input.choices,
    {
      id: BACK_FLOW_TOKEN,
      title: input.locale === "it" ? "Indietro" : "Back"
    },
    buildRestartChoice(input.locale)
  ].slice(0, 10);
}

async function promptIntent(input: ConversationInput, deps: WhatsAppConversationDeps) {
  const bodyText =
    input.locale === "it"
      ? "Cosa vuoi fare?"
      : "What would you like to do?";
  await deps.sendList(input.from, bodyText, input.locale === "it" ? "Scegli" : "Choose", appendFlowRows({
    choices: [
    {
      id: "intent:new",
      title: input.locale === "it" ? "Nuova prenotazione" : "New booking"
    },
    {
      id: "intent:reschedule",
      title: input.locale === "it" ? "Sposta prenotazione" : "Reschedule booking"
    },
    {
      id: "intent:cancel",
      title: input.locale === "it" ? "Annulla prenotazione" : "Cancel booking"
    }
    ],
    locale: input.locale
  }));
}

async function promptBookingSelectionForAction(input: {
  from: string;
  locale: SupportedLocale;
  page: number;
  action: "cancel" | "reschedule";
  deps: WhatsAppConversationDeps;
}) {
  const timezone = await input.deps.getTenantTimezone();
  const items = (await input.deps.listBookingsByPhone({ phone: input.from, limit: 10 }))
    .filter((item) => item.status === "pending" || item.status === "confirmed")
    .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
  const uiMode = pickBookingSelectionUiMode(items.length);
  console.info("[bot] booking selection ui", {
    action: input.action,
    bookingsCount: items.length,
    uiMode,
    locale: input.locale
  });

  if (items.length === 0) {
    await input.deps.sendButtons(
      input.from,
      input.locale === "it"
        ? "Non ci sono prenotazioni attive da gestire. Cosa vuoi fare?"
        : "There are no active bookings to manage. What would you like to do?",
      [
        {
          id: "intent:new",
          title: input.locale === "it" ? "Nuova prenotazione" : "New booking"
        },
        {
          id: "intent:cancel",
          title: input.locale === "it" ? "Annulla prenotazione" : "Cancel booking"
        },
        {
          id: "intent:reschedule",
          title: input.locale === "it" ? "Sposta prenotazione" : "Reschedule booking"
        }
      ]
    );
    return false;
  }

  const labelPrefix =
    input.action === "cancel"
      ? input.locale === "it"
        ? "Annulla prenotazione"
        : "Cancel booking"
      : input.locale === "it"
        ? "Sposta prenotazione"
        : "Reschedule booking";

  if (uiMode === "buttons") {
    const choices: Choice[] = items.slice(0, BOOKING_SELECTION_BUTTONS_MAX_ITEMS).map((item) => ({
      id: `booking:${item.id}`,
      title: truncateForChoice(formatDateTimeLabel(item.startAt, input.locale, timezone), 24)
    }));
    choices.push({
      id: BACK_FLOW_TOKEN,
      title: input.locale === "it" ? "Indietro" : "Back"
    });
    await input.deps.sendButtons(input.from, labelPrefix, choices.slice(0, 3));
    return true;
  }

  const { choices } = buildPaginatedList({
    items,
    page: input.page,
    mapChoice: (item) => ({
      id: `booking:${item.id}`,
      title: truncateForChoice(formatDateTimeLabel(item.startAt, input.locale, timezone), 24)
    }),
    navPrefix: "bookingpage",
    locale: input.locale
  });
  await input.deps.sendList(input.from, labelPrefix, input.locale === "it" ? "Prenotazioni" : "Bookings", appendFlowRows({ choices, locale: input.locale }));
  return true;
}

function pickBookingSelectionUiMode(count: number): BookingSelectionUiMode {
  if (count <= 0) {
    return "none";
  }
  if (count <= BOOKING_SELECTION_BUTTONS_MAX_ITEMS) {
    return "buttons";
  }
  return "list";
}

async function promptService(
  input: ConversationInput,
  session: WhatsAppConversationSession,
  deps: WhatsAppConversationDeps
) {
  const services = await deps.fetchServices(session.locale);
  if (services.length === 0) {
    await deps.sendText(
      input.from,
      session.locale === "it"
        ? "Al momento non ci sono servizi disponibili."
        : "No services are currently available."
    );
    return;
  }

  const bodyText =
    session.locale === "it" ? "Seleziona il servizio." : "Select a service.";
  const { choices, safePage, totalPages } = buildPaginatedList({
    items: services.slice(0, 10),
    page: session.servicePage ?? 0,
    mapChoice: (service) => ({
      id: `service:${service.id}`,
      title: truncateForChoice(service.displayName, 24),
      description:
        typeof service.durationMinutes === "number" ? `${service.durationMinutes} min` : undefined
    }),
    navPrefix: "servicepage",
    locale: session.locale
  });
  await deps.sendList(
    input.from,
    bodyText,
    session.locale === "it" ? "Servizi" : "Services",
    appendFlowRows({ choices, locale: session.locale })
  );
}

async function promptMaster(
  input: ConversationInput,
  session: WhatsAppConversationSession,
  deps: WhatsAppConversationDeps
) {
  const masters = await deps.fetchMasters(session.locale, session.serviceId);
  if (masters.length === 0) {
    await deps.sendText(
      input.from,
      session.locale === "it" ? "Nessun master disponibile." : "No masters are available."
    );
    return;
  }

  const bodyText = session.locale === "it" ? "Scegli il master." : "Choose a master.";
  const { choices, safePage, totalPages } = buildPaginatedList({
    items: masters.slice(0, 10),
    page: session.masterPage ?? 0,
    mapChoice: (master) => ({
      id: `master:${master.id}`,
      title: truncateForChoice(master.displayName, 24)
    }),
    navPrefix: "masterpage",
    locale: session.locale
  });
  await deps.sendList(
    input.from,
    bodyText,
    session.locale === "it" ? "Master" : "Masters",
    appendFlowRows({ choices, locale: session.locale })
  );
}

async function promptDate(
  input: ConversationInput,
  session: WhatsAppConversationSession,
  deps: WhatsAppConversationDeps
) {
  const timezone = await deps.getTenantTimezone();
  const days = buildNext7Days(timezone);
  const { choices, safePage, totalPages } = buildPaginatedList({
    items: days,
    page: session.datePage ?? 0,
    mapChoice: (day) => ({
      id: `date:${day}`,
      title: truncateForChoice(formatDateLabel(day, session.locale, timezone), 24),
      description: day
    }),
    navPrefix: "datepage",
    locale: session.locale
  });

  await deps.sendList(
    input.from,
    session.locale === "it" ? "Scegli una data." : "Choose a date.",
    session.locale === "it" ? "Date" : "Dates",
    appendFlowRows({ choices, locale: session.locale })
  );
}

async function promptSlot(
  input: ConversationInput,
  session: WhatsAppConversationSession,
  deps: WhatsAppConversationDeps
) {
  if (!session.serviceId || !session.date) {
    return;
  }

  const slots = await deps.fetchSlots({
    serviceId: session.serviceId,
    masterId: session.masterId,
    date: session.date,
    locale: session.locale
  });

  if (slots.length === 0) {
    const timezone = await deps.getTenantTimezone();
    const days = buildNext7Days(timezone).filter((day) => day !== session.date);
    const dayChoices = days.slice(0, 8).map((day) => ({
      id: `date:${day}`,
      title: truncateForChoice(formatDateLabel(day, session.locale, timezone), 24),
      description: day
    }));

    session.state = "choose_date";
    session.datePage = 0;
    await deps.saveSession(input.from, session);
    await deps.sendList(
      input.from,
      session.locale === "it"
        ? "Nessuno slot disponibile per questa data. Scegli un'altra data."
        : "No slots are available for this date. Please choose another date.",
      session.locale === "it" ? "Date" : "Dates",
      appendFlowRows({ choices: dayChoices, locale: session.locale })
    );
    return;
  }

  const pageSize = 8;
  const page = Math.max(session.slotPage ?? 0, 0);
  const pageStart = page * pageSize;
  const pageItems = slots.slice(pageStart, pageStart + pageSize);
  if (pageItems.length === 0) {
    session.slotPage = 0;
    await deps.saveSession(input.from, session);
    return promptSlot(input, session, deps);
  }

  const choices: Choice[] = pageItems.map((slot) => ({
    id: `slot:${encodeURIComponent(slot.startAt)}`,
    title: truncateForChoice(slot.displayTime, 24)
  }));
  if (pageStart > 0) {
    choices.push({
      id: "slotpage:prev",
      title: session.locale === "it" ? "Indietro" : "Previous"
    });
  }
  if (pageStart + pageSize < slots.length) {
    choices.push({
      id: "slotpage:next",
      title: session.locale === "it" ? "Avanti" : "Next"
    });
  }
  await deps.sendList(
    input.from,
    session.locale === "it" ? "Scegli un orario." : "Choose a time.",
    session.locale === "it" ? "Orari" : "Times",
    appendFlowRows({ choices: choices.slice(0, 8), locale: session.locale })
  );
}

async function promptConfirm(
  input: ConversationInput,
  session: WhatsAppConversationSession,
  deps: WhatsAppConversationDeps
) {
  const summary =
    session.locale === "it"
      ? `Confermi prenotazione?\nNome: ${session.clientName ?? "-"}\nServizio: ${session.serviceName ?? "-"}\nMaster: ${session.masterName ?? "-"}\nData: ${session.date ?? "-"}\nOrario: ${session.slotDisplayTime ?? "-"}`
      : `Confirm booking?\nName: ${session.clientName ?? "-"}\nService: ${session.serviceName ?? "-"}\nMaster: ${session.masterName ?? "-"}\nDate: ${session.date ?? "-"}\nTime: ${session.slotDisplayTime ?? "-"}`;

  const confirmCta = deps.createFlowCtaAction?.({
    action: "flow_confirm_booking",
    bookingId: session.bookingIdToReschedule ?? "draft",
    phone: input.from,
    ttlMinutes: 20
  });
  if (confirmCta) {
    await deps.sendButtons(input.from, summary, [
      {
        id: `cta:${confirmCta}`,
        title: session.locale === "it" ? "Conferma" : "Confirm"
      },
      {
        id: "confirm:change",
        title: session.locale === "it" ? "Cambia data" : "Change date"
      },
      {
        id: "confirm:cancel",
        title: session.locale === "it" ? "Annulla" : "Cancel"
      }
    ]);
    return;
  }

  await deps.sendList(
    input.from,
    summary,
    session.locale === "it" ? "Conferma" : "Confirm",
    [
      {
        id: "confirm:yes",
        title: session.locale === "it" ? "Conferma" : "Confirm"
      },
      {
        id: "confirm:change",
        title: session.locale === "it" ? "Cambia data" : "Change date"
      },
      {
        id: "confirm:cancel",
        title: session.locale === "it" ? "Annulla" : "Cancel"
      },
      {
        id: BACK_FLOW_TOKEN,
        title: session.locale === "it" ? "Indietro" : "Back"
      },
      buildRestartChoice(session.locale)
    ].slice(0, 10)
  );
}

async function promptClientName(
  input: ConversationInput,
  session: WhatsAppConversationSession,
  deps: WhatsAppConversationDeps
) {
  await deps.sendText(
    input.from,
    session.locale === "it"
      ? "Perfetto. Ora scrivi il tuo nome e cognome."
      : "Great. Now please type your full name."
  );
}

function parseClientName(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length < 2 || compact.length > 80) {
    return undefined;
  }
  if (/^(intent:|service:|master:|date:|slot:|confirm:|booking:|flow:)/i.test(compact)) {
    return undefined;
  }
  return compact;
}

async function promptCancelConfirm(
  input: ConversationInput,
  session: WhatsAppConversationSession,
  deps: WhatsAppConversationDeps
) {
  const when = session.slotDisplayTime ?? session.date ?? "-";
  const summary =
    session.locale === "it"
      ? `Stai per annullare la prenotazione:\nQuando: ${when}\nSei sicuro?`
      : `You are about to cancel the booking:\nWhen: ${when}\nAre you sure?`;

  const confirmCancelCta = session.bookingIdInContext
    ? deps.createFlowCtaAction?.({
        action: "flow_confirm_cancel",
        bookingId: session.bookingIdInContext,
        phone: input.from,
        ttlMinutes: 20
      })
    : undefined;
  if (confirmCancelCta) {
    await deps.sendButtons(input.from, summary, [
      {
        id: `cta:${confirmCancelCta}`,
        title: session.locale === "it" ? "Conferma annullo" : "Confirm cancel"
      },
      {
        id: "confirm:cancel",
        title: session.locale === "it" ? "Non annullare" : "Keep booking"
      },
      {
        id: BACK_FLOW_TOKEN,
        title: session.locale === "it" ? "Indietro" : "Back"
      }
    ]);
    return;
  }

  await deps.sendList(
    input.from,
    summary,
    session.locale === "it" ? "Conferma" : "Confirm",
    [
      {
        id: "confirm:yes",
        title: session.locale === "it" ? "Conferma annullo" : "Confirm cancel"
      },
      {
        id: "confirm:cancel",
        title: session.locale === "it" ? "Non annullare" : "Keep booking"
      },
      {
        id: BACK_FLOW_TOKEN,
        title: session.locale === "it" ? "Indietro" : "Back"
      },
      buildRestartChoice(session.locale)
    ].slice(0, 10)
  );
}

async function runCreateOrReschedule(
  input: ConversationInput,
  session: WhatsAppConversationSession,
  deps: WhatsAppConversationDeps
) {
  if (!session.serviceId || !session.slotStartAt) {
    await deps.sendText(
      input.from,
      session.locale === "it" ? "Sessione non valida, riprova." : "Invalid session, please try again."
    );
    await deps.clearSession(input.from);
    return;
  }

  if (session.intent === "reschedule_booking" && session.bookingIdToReschedule) {
    await deps.rescheduleBooking({
      bookingId: session.bookingIdToReschedule,
      phone: input.from,
      serviceId: session.serviceId,
      masterId: session.masterId,
      startAtIso: session.slotStartAt,
      locale: session.locale
    });
    await deps.sendText(
      input.from,
      session.locale === "it"
        ? "Prenotazione spostata con successo."
        : "Booking rescheduled successfully."
    );
  } else {
    await deps.createBooking({
      serviceId: session.serviceId,
      masterId: session.masterId,
      startAtIso: session.slotStartAt,
      phone: input.from,
      locale: session.locale,
      clientName: session.clientName ?? "WhatsApp Client"
    });
    await deps.sendText(
      input.from,
      session.locale === "it"
        ? "Richiesta prenotazione ricevuta. Attendi conferma dall'amministratore."
        : "Booking request received. Please wait for admin confirmation."
    );
  }

  await deps.clearSession(input.from);
}

async function runCancelWithConfirm(
  input: ConversationInput,
  session: WhatsAppConversationSession,
  deps: WhatsAppConversationDeps
) {
  if (!session.bookingIdInContext) {
    await deps.sendText(
      input.from,
      session.locale === "it" ? "Sessione non valida, riprova." : "Invalid session, please try again."
    );
    await deps.clearSession(input.from);
    return;
  }

  try {
    await deps.cancelBooking({
      bookingId: session.bookingIdInContext,
      phone: input.from
    });
    await deps.sendText(
      input.from,
      session.locale === "it"
        ? "Prenotazione annullata."
        : "Booking cancelled."
    );
  } catch {
    await deps.sendText(
      input.from,
      session.locale === "it"
        ? "Non riesco ad annullare la prenotazione. Verifica e riprova."
        : "Unable to cancel booking. Please verify details and try again."
    );
  }

  await deps.clearSession(input.from);
}

export async function processWhatsAppConversation(
  input: ConversationInput,
  deps: WhatsAppConversationDeps,
  options?: { skipDedup?: boolean }
): Promise<{ handled: boolean }> {
  if (!options?.skipDedup) {
    const notDuplicate = await deps.dedupInboundMessage(input.messageId);
    if (!notDuplicate) {
      return { handled: true };
    }
  }

  const token = normalizeToken(input);
  const normalizedToken = token.toLowerCase();
  let session = (await deps.loadSession(input.from)) ?? createInitialSession(input.locale);

  if (normalizedToken === "/start" || normalizedToken === "start" || normalizedToken === "menu") {
    session = createInitialSession(input.locale);
    await deps.saveSession(input.from, session);
    await promptIntent(input, deps);
    return { handled: true };
  }
  if (
    normalizedToken === RESTART_FLOW_TOKEN ||
    normalizedToken === "restart"
  ) {
    session = createInitialSession(input.locale);
    await deps.saveSession(input.from, session);
    await promptIntent(input, deps);
    return { handled: true };
  }
  if (normalizedToken === BACK_FLOW_TOKEN || normalizedToken === "back") {
    switch (session.state) {
      case "choose_master":
        session.state = "choose_service";
        session.servicePage = 0;
        await deps.saveSession(input.from, session);
        await promptService(input, session, deps);
        return { handled: true };
      case "choose_date":
        session.state = "choose_master";
        session.masterPage = 0;
        await deps.saveSession(input.from, session);
        await promptMaster(input, session, deps);
        return { handled: true };
      case "choose_slot":
        session.state = "choose_date";
        session.datePage = 0;
        await deps.saveSession(input.from, session);
        await promptDate(input, session, deps);
        return { handled: true };
      case "collect_client_name":
        session.state = "choose_slot";
        session.slotPage = 0;
        await deps.saveSession(input.from, session);
        await promptSlot(input, session, deps);
        return { handled: true };
      case "confirm":
        if (session.intent === "cancel_booking") {
          session.state = "cancel_wait_booking_id";
          session.bookingPage = 0;
          await deps.saveSession(input.from, session);
          await promptBookingSelectionForAction({
            from: input.from,
            locale: session.locale,
            page: session.bookingPage,
            action: "cancel",
            deps
          });
          return { handled: true };
        }
        session.state = "choose_slot";
        session.slotPage = 0;
        await deps.saveSession(input.from, session);
        await promptSlot(input, session, deps);
        return { handled: true };
      default:
        session = createInitialSession(input.locale);
        await deps.saveSession(input.from, session);
        await promptIntent(input, deps);
        return { handled: true };
      }
  }

  if (normalizedToken === "/cancel" || normalizedToken === "cancel" || normalizedToken === "annulla") {
    session.intent = "cancel_booking";
    session.state = "cancel_wait_booking_id";
    session.bookingPage = 0;
    await deps.saveSession(input.from, session);
    const shown = await promptBookingSelectionForAction({
      from: input.from,
      locale: session.locale,
      page: session.bookingPage,
      action: "cancel",
      deps
    });
    if (!shown) {
      await deps.clearSession(input.from);
    }
    return { handled: true };
  }

  if (!session.intent && session.state !== "choose_intent") {
    session = createInitialSession(input.locale);
  }

  switch (session.state) {
    case "choose_intent": {
      if (token === "intent:new") {
        session.intent = "new_booking";
        session.state = "choose_service";
        session.servicePage = 0;
        await deps.saveSession(input.from, session);
        await promptService(input, session, deps);
        return { handled: true };
      }
      if (token === "intent:cancel") {
        session.intent = "cancel_booking";
        session.state = "cancel_wait_booking_id";
        await deps.saveSession(input.from, session);
        const shown = await promptBookingSelectionForAction({
          from: input.from,
          locale: session.locale,
          page: session.bookingPage ?? 0,
          action: "cancel",
          deps
        });
        if (!shown) {
          await deps.clearSession(input.from);
        }
        return { handled: true };
      }
      if (token === "intent:reschedule") {
        session.intent = "reschedule_booking";
        session.state = "reschedule_wait_booking_id";
        await deps.saveSession(input.from, session);
        const shown = await promptBookingSelectionForAction({
          from: input.from,
          locale: session.locale,
          page: session.bookingPage ?? 0,
          action: "reschedule",
          deps
        });
        if (!shown) {
          await deps.clearSession(input.from);
        }
        return { handled: true };
      }
      await promptIntent(input, deps);
      return { handled: true };
    }

    case "reschedule_wait_booking_id": {
      if (token === "bookingpage:next") {
        session.bookingPage = Math.max((session.bookingPage ?? 0) + 1, 0);
        await deps.saveSession(input.from, session);
        await promptBookingSelectionForAction({
          from: input.from,
          locale: session.locale,
          page: session.bookingPage,
          action: "reschedule",
          deps
        });
        return { handled: true };
      }
      if (token === "bookingpage:prev") {
        session.bookingPage = Math.max((session.bookingPage ?? 0) - 1, 0);
        await deps.saveSession(input.from, session);
        await promptBookingSelectionForAction({
          from: input.from,
          locale: session.locale,
          page: session.bookingPage,
          action: "reschedule",
          deps
        });
        return { handled: true };
      }
      const bookingToken = token.startsWith("booking:") ? token.replace("booking:", "") : token;
      if (!isUuidLike(bookingToken)) {
        await promptBookingSelectionForAction({
          from: input.from,
          locale: session.locale,
          page: session.bookingPage ?? 0,
          action: "reschedule",
          deps
        });
        return { handled: true };
      }
      const bookingId = bookingToken.trim();
      const activeBookings = await deps.listBookingsByPhone({ phone: input.from, limit: 50 });
      const exists = activeBookings.some(
        (item) => item.id === bookingId && (item.status === "pending" || item.status === "confirmed")
      );
      if (!exists) {
        await deps.sendText(
          input.from,
          session.locale === "it"
            ? "Questa prenotazione non e piu disponibile. Scegli di nuovo."
            : "This booking is no longer available. Please choose again."
        );
        await promptBookingSelectionForAction({
          from: input.from,
          locale: session.locale,
          page: session.bookingPage ?? 0,
          action: "reschedule",
          deps
        });
        return { handled: true };
      }
      session.bookingIdToReschedule = bookingId;
      session.state = "choose_service";
      session.servicePage = 0;
      await deps.saveSession(input.from, session);
      await promptService(input, session, deps);
      return { handled: true };
    }

    case "cancel_wait_booking_id": {
      if (token === "bookingpage:next") {
        session.bookingPage = Math.max((session.bookingPage ?? 0) + 1, 0);
        await deps.saveSession(input.from, session);
        await promptBookingSelectionForAction({
          from: input.from,
          locale: session.locale,
          page: session.bookingPage,
          action: "cancel",
          deps
        });
        return { handled: true };
      }
      if (token === "bookingpage:prev") {
        session.bookingPage = Math.max((session.bookingPage ?? 0) - 1, 0);
        await deps.saveSession(input.from, session);
        await promptBookingSelectionForAction({
          from: input.from,
          locale: session.locale,
          page: session.bookingPage,
          action: "cancel",
          deps
        });
        return { handled: true };
      }
      const bookingToken = token.startsWith("booking:") ? token.replace("booking:", "") : token;
      if (!isUuidLike(bookingToken)) {
        await promptBookingSelectionForAction({
          from: input.from,
          locale: session.locale,
          page: session.bookingPage ?? 0,
          action: "cancel",
          deps
        });
        return { handled: true };
      }
      const bookingId = bookingToken.trim();
      const activeBookings = await deps.listBookingsByPhone({ phone: input.from, limit: 50 });
      const matchedBooking = activeBookings.find(
        (item) => item.id === bookingId && (item.status === "pending" || item.status === "confirmed")
      );
      if (!matchedBooking) {
        await deps.sendText(
          input.from,
          session.locale === "it"
            ? "Questa prenotazione non e piu disponibile. Scegli di nuovo."
            : "This booking is no longer available. Please choose again."
        );
        await promptBookingSelectionForAction({
          from: input.from,
          locale: session.locale,
          page: session.bookingPage ?? 0,
          action: "cancel",
          deps
        });
        return { handled: true };
      }
      session.bookingIdInContext = bookingId;
      session.intent = "cancel_booking";
      session.state = "confirm";
      try {
        if (matchedBooking.startAt) {
          const timezone = await deps.getTenantTimezone();
          session.slotDisplayTime = formatDateTimeLabel(matchedBooking.startAt, session.locale, timezone);
        }
      } catch {
        // Ignore enrichment errors, confirmation can still proceed with limited context.
      }
      await deps.saveSession(input.from, session);
      await promptCancelConfirm(input, session, deps);
      return { handled: true };
    }

    case "choose_service": {
      if (token === "servicepage:next") {
        session.servicePage = Math.max((session.servicePage ?? 0) + 1, 0);
        await deps.saveSession(input.from, session);
        await promptService(input, session, deps);
        return { handled: true };
      }
      if (token === "servicepage:prev") {
        session.servicePage = Math.max((session.servicePage ?? 0) - 1, 0);
        await deps.saveSession(input.from, session);
        await promptService(input, session, deps);
        return { handled: true };
      }
      if (!token.startsWith("service:")) {
        await promptService(input, session, deps);
        return { handled: true };
      }
      const serviceId = token.replace("service:", "");
      const services = await deps.fetchServices(session.locale);
      const picked = services.find((item) => item.id === serviceId);
      if (!picked) {
        await promptService(input, session, deps);
        return { handled: true };
      }
      session.serviceId = picked.id;
      session.serviceName = picked.displayName;
      session.state = "choose_master";
      session.masterPage = 0;
      await deps.saveSession(input.from, session);
      await promptMaster(input, session, deps);
      return { handled: true };
    }

    case "choose_master": {
      if (token === "masterpage:next") {
        session.masterPage = Math.max((session.masterPage ?? 0) + 1, 0);
        await deps.saveSession(input.from, session);
        await promptMaster(input, session, deps);
        return { handled: true };
      }
      if (token === "masterpage:prev") {
        session.masterPage = Math.max((session.masterPage ?? 0) - 1, 0);
        await deps.saveSession(input.from, session);
        await promptMaster(input, session, deps);
        return { handled: true };
      }
      if (!token.startsWith("master:")) {
        await promptMaster(input, session, deps);
        return { handled: true };
      }
      const masterId = token.replace("master:", "");
      const masters = await deps.fetchMasters(session.locale);
      const picked = masters.find((item) => item.id === masterId);
      if (!picked) {
        await promptMaster(input, session, deps);
        return { handled: true };
      }
      session.masterId = picked.id;
      session.masterName = picked.displayName;
      session.state = "choose_date";
      session.datePage = 0;
      session.slotPage = 0;
      await deps.saveSession(input.from, session);
      await promptDate(input, session, deps);
      return { handled: true };
    }

    case "choose_date": {
      if (token === "datepage:next") {
        session.datePage = Math.max((session.datePage ?? 0) + 1, 0);
        await deps.saveSession(input.from, session);
        await promptDate(input, session, deps);
        return { handled: true };
      }
      if (token === "datepage:prev") {
        session.datePage = Math.max((session.datePage ?? 0) - 1, 0);
        await deps.saveSession(input.from, session);
        await promptDate(input, session, deps);
        return { handled: true };
      }
      if (!token.startsWith("date:")) {
        await promptDate(input, session, deps);
        return { handled: true };
      }
      session.date = token.replace("date:", "");
      session.slotPage = 0;
      session.state = "choose_slot";
      await deps.saveSession(input.from, session);
      await promptSlot(input, session, deps);
      return { handled: true };
    }

    case "choose_slot": {
      if (token === "slotpage:next") {
        session.slotPage = Math.max((session.slotPage ?? 0) + 1, 0);
        await deps.saveSession(input.from, session);
        await promptSlot(input, session, deps);
        return { handled: true };
      }
      if (token === "slotpage:prev") {
        session.slotPage = Math.max((session.slotPage ?? 0) - 1, 0);
        await deps.saveSession(input.from, session);
        await promptSlot(input, session, deps);
        return { handled: true };
      }
      if (!token.startsWith("slot:")) {
        await promptSlot(input, session, deps);
        return { handled: true };
      }
      const slotStartAt = decodeURIComponent(token.replace("slot:", ""));
      const slots = await deps.fetchSlots({
        serviceId: session.serviceId ?? "",
        masterId: session.masterId,
        date: session.date ?? "",
        locale: session.locale
      });
      const picked = slots.find((item) => item.startAt === slotStartAt);
      if (!picked) {
        await promptSlot(input, session, deps);
        return { handled: true };
      }
      session.slotStartAt = picked.startAt;
      session.slotDisplayTime = picked.displayTime;
      session.state = "collect_client_name";
      await deps.saveSession(input.from, session);
      await promptClientName(input, session, deps);
      return { handled: true };
    }

    case "collect_client_name": {
      const parsedName = parseClientName(input.text ?? token);
      if (!parsedName) {
        await deps.sendText(
          input.from,
          session.locale === "it"
            ? "Per continuare, scrivi un nome valido (minimo 2 caratteri)."
            : "To continue, type a valid name (at least 2 characters)."
        );
        await promptClientName(input, session, deps);
        return { handled: true };
      }
      session.clientName = parsedName;
      session.state = "confirm";
      await deps.saveSession(input.from, session);
      await promptConfirm(input, session, deps);
      return { handled: true };
    }

    case "confirm": {
      if (token === "confirm:yes") {
        if (session.intent === "cancel_booking") {
          await runCancelWithConfirm(input, session, deps);
          return { handled: true };
        }
        await runCreateOrReschedule(input, session, deps);
        return { handled: true };
      }
      if (token === "confirm:change") {
        if (session.intent === "cancel_booking") {
          session.state = "cancel_wait_booking_id";
          session.bookingPage = 0;
          await deps.saveSession(input.from, session);
          await promptBookingSelectionForAction({
            from: input.from,
            locale: session.locale,
            page: session.bookingPage,
            action: "cancel",
            deps
          });
          return { handled: true };
        }
        session.state = "choose_date";
        session.datePage = 0;
        await deps.saveSession(input.from, session);
        await promptDate(input, session, deps);
        return { handled: true };
      }
      if (token === "confirm:cancel") {
        await deps.sendText(
          input.from,
          session.locale === "it" ? "Operazione annullata." : "Operation cancelled."
        );
        await deps.clearSession(input.from);
        return { handled: true };
      }
      await promptConfirm(input, session, deps);
      return { handled: true };
    }
    default:
      await promptIntent(input, deps);
      return { handled: true };
  }
}
