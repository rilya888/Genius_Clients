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

type ConversationState =
  | "choose_intent"
  | "choose_service"
  | "choose_master"
  | "choose_date"
  | "choose_slot"
  | "confirm"
  | "cancel_wait_booking_id"
  | "reschedule_wait_booking_id";

type ConversationIntent = "new_booking" | "cancel_booking" | "reschedule_booking";

export type WhatsAppConversationSession = {
  flowVersion: number;
  locale: SupportedLocale;
  state: ConversationState;
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
  bookingIdToReschedule?: string;
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

export type WhatsAppConversationDeps = {
  dedupInboundMessage: (messageId: string) => Promise<boolean>;
  loadSession: (phone: string) => Promise<WhatsAppConversationSession | null>;
  saveSession: (phone: string, session: WhatsAppConversationSession) => Promise<void>;
  clearSession: (phone: string) => Promise<void>;
  sendText: (to: string, text: string) => Promise<void>;
  sendList: (to: string, bodyText: string, buttonText: string, choices: Choice[]) => Promise<void>;
  sendButtons: (to: string, bodyText: string, choices: Choice[]) => Promise<void>;
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

function truncateForChoice(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxLength - 1))}…`;
}

function createInitialSession(locale: SupportedLocale): WhatsAppConversationSession {
  return {
    flowVersion: FLOW_VERSION,
    locale,
    state: "choose_intent",
    servicePage: 0,
    masterPage: 0,
    datePage: 0,
    bookingPage: 0,
    slotPage: 0
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
  const items = await input.deps.listBookingsByPhone({ phone: input.from, limit: 10 });
  if (items.length === 0) {
    await input.deps.sendText(
      input.from,
      input.locale === "it"
        ? "Non ci sono prenotazioni attive da gestire."
        : "There are no active bookings to manage."
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

  const { choices, safePage, totalPages } = buildPaginatedList({
    items,
    page: input.page,
    mapChoice: (item) => ({
      id: `booking:${item.id}`,
      title: truncateForChoice(formatDateTimeLabel(item.startAt, input.locale, timezone), 24)
    }),
    navPrefix: "bookingpage",
    locale: input.locale
  });
  await input.deps.sendList(
    input.from,
    `${labelPrefix} (${safePage + 1}/${totalPages})`,
    input.locale === "it" ? "Prenotazioni" : "Bookings",
    appendFlowRows({ choices, locale: input.locale })
  );
  return true;
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
    `${bodyText} (${safePage + 1}/${totalPages})`,
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
    `${bodyText} (${safePage + 1}/${totalPages})`,
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
    `${session.locale === "it" ? "Scegli una data (7 giorni)." : "Choose a date (next 7 days)."} (${safePage + 1}/${totalPages})`,
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
    await deps.sendText(
      input.from,
      session.locale === "it"
        ? "Questa pagina non ha slot. Torno alla prima pagina."
        : "This page has no slots. Returning to the first page."
    );
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
    session.locale === "it"
      ? `Scegli uno slot. Pagina ${page + 1}.`
      : `Choose a slot. Page ${page + 1}.`,
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
      ? `Confermi prenotazione?\nServizio: ${session.serviceName ?? "-"}\nMaster: ${session.masterName ?? "-"}\nData: ${session.date ?? "-"}\nOrario: ${session.slotDisplayTime ?? "-"}`
      : `Confirm booking?\nService: ${session.serviceName ?? "-"}\nMaster: ${session.masterName ?? "-"}\nDate: ${session.date ?? "-"}\nTime: ${session.slotDisplayTime ?? "-"}`;

  await deps.sendList(input.from, summary, session.locale === "it" ? "Conferma" : "Confirm", [
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
    }
  ,
    {
      id: BACK_FLOW_TOKEN,
      title: session.locale === "it" ? "Indietro" : "Back"
    },
    buildRestartChoice(session.locale)
  ].slice(0, 10));
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
      clientName: "WhatsApp Client"
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

export async function processWhatsAppConversation(
  input: ConversationInput,
  deps: WhatsAppConversationDeps
): Promise<{ handled: boolean }> {
  const notDuplicate = await deps.dedupInboundMessage(input.messageId);
  if (!notDuplicate) {
    return { handled: true };
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
      case "confirm":
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
      session.bookingIdToReschedule = bookingToken.trim();
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
      try {
        await deps.cancelBooking({
          bookingId: bookingToken.trim(),
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
            ? "Non riesco ad annullare la prenotazione. Verifica codice e telefono."
            : "Unable to cancel booking. Please verify booking code and phone."
        );
      }
      await deps.clearSession(input.from);
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
      session.state = "confirm";
      await deps.saveSession(input.from, session);
      await promptConfirm(input, session, deps);
      return { handled: true };
    }

    case "confirm": {
      if (token === "confirm:yes") {
        await runCreateOrReschedule(input, session, deps);
        return { handled: true };
      }
      if (token === "confirm:change") {
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
