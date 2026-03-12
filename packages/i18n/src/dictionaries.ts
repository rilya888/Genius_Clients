export type SupportedLocale = "it" | "en";

type Dictionary = Record<string, string>;

const commonIt: Dictionary = {
  "common.actions.save": "Salva",
  "common.actions.cancel": "Annulla",
  "common.actions.refresh": "Aggiorna",
  "common.bookingStatus.pending": "In attesa",
  "common.bookingStatus.confirmed": "Confermato",
  "common.bookingStatus.completed": "Completato",
  "common.bookingStatus.cancelled": "Annullato",
  "common.errors.generic": "Si e verificato un errore. Riprova."
};

const commonEn: Dictionary = {
  "common.actions.save": "Save",
  "common.actions.cancel": "Cancel",
  "common.actions.refresh": "Refresh",
  "common.bookingStatus.pending": "Pending",
  "common.bookingStatus.confirmed": "Confirmed",
  "common.bookingStatus.completed": "Completed",
  "common.bookingStatus.cancelled": "Cancelled",
  "common.errors.generic": "An error occurred. Please try again."
};

const adminIt: Dictionary = {
  "admin.dashboard.title": "Pannello amministrazione",
  "admin.nav.masters": "Collaboratori",
  "admin.nav.services": "Servizi",
  "admin.nav.bookings": "Prenotazioni",
  "admin.nav.settings": "Impostazioni tenant"
};

const adminEn: Dictionary = {
  "admin.dashboard.title": "Admin Dashboard",
  "admin.nav.masters": "Masters",
  "admin.nav.services": "Services",
  "admin.nav.bookings": "Bookings",
  "admin.nav.settings": "Tenant Settings"
};

const publicIt: Dictionary = {
  "public.booking.title": "Prenotazione online",
  "public.booking.selectService": "Seleziona servizio",
  "public.booking.anyMaster": "Qualsiasi operatore",
  "public.booking.findSlots": "Trova disponibilita",
  "public.booking.slots": "Disponibilita",
  "public.booking.clientSection": "Dati cliente",
  "public.booking.namePlaceholder": "Nome completo",
  "public.booking.phonePlaceholder": "Telefono E.164",
  "public.booking.emailPlaceholder": "Email (opzionale)",
  "public.booking.bookAction": "Prenota",
  "public.booking.consent": "Acconsento al trattamento dei dati personali per la prenotazione",
  "public.booking.phoneInvalid": "Il telefono deve essere in formato E.164, ad esempio +393331234567.",
  "public.booking.loadCatalogFailed": "Impossibile caricare il catalogo.",
  "public.booking.loadSlotsFailed": "Impossibile caricare le disponibilita.",
  "public.booking.createFailed": "Impossibile creare la prenotazione.",
  "public.booking.created": "Richiesta prenotazione ricevuta: {bookingId}",
  "public.booking.selected": "Selezionato: {dateTime} con {masterName}",
  "public.booking.successTitle": "Richiesta inviata",
  "public.booking.successText": "La richiesta e stata ricevuta. Attenda la conferma dell'amministratore.",
  "public.booking.bookAnother": "Nuova prenotazione",
  "public.booking.backHome": "Torna alla home"
};

const publicEn: Dictionary = {
  "public.booking.title": "Online Booking",
  "public.booking.selectService": "Select service",
  "public.booking.anyMaster": "Any master",
  "public.booking.findSlots": "Find slots",
  "public.booking.slots": "Slots",
  "public.booking.clientSection": "Client details",
  "public.booking.namePlaceholder": "Full name",
  "public.booking.phonePlaceholder": "Phone E.164",
  "public.booking.emailPlaceholder": "Email (optional)",
  "public.booking.bookAction": "Book",
  "public.booking.consent": "I consent to personal data processing for booking",
  "public.booking.phoneInvalid": "Phone must be in E.164 format, for example +393331234567.",
  "public.booking.loadCatalogFailed": "Failed to load catalog.",
  "public.booking.loadSlotsFailed": "Failed to load slots.",
  "public.booking.createFailed": "Failed to create booking.",
  "public.booking.created": "Booking request received: {bookingId}",
  "public.booking.selected": "Selected: {dateTime} with {masterName}",
  "public.booking.successTitle": "Request submitted",
  "public.booking.successText": "Your booking request has been received. Please wait for admin confirmation.",
  "public.booking.bookAnother": "Book another",
  "public.booking.backHome": "Back to home"
};

const authIt: Dictionary = {
  "auth.title": "Accesso",
  "auth.login": "Accedi",
  "auth.register": "Registrati",
  "auth.logout": "Esci",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.businessName": "Nome attivita",
  "auth.slugOptional": "Slug (opzionale)",
  "auth.submitting": "Invio in corso...",
  "auth.authenticated": "Autenticato",
  "auth.loggedOut": "Disconnesso",
  "auth.profileLoadFailed": "Autenticato, ma il profilo non e disponibile",
  "auth.requestVerification": "Richiedi verifica email",
  "auth.verifyEmail": "Conferma email",
  "auth.verificationToken": "Token verifica",
  "auth.verificationRequested": "Richiesta di verifica inviata",
  "auth.emailVerified": "Email verificata"
};

const authEn: Dictionary = {
  "auth.title": "Auth",
  "auth.login": "Login",
  "auth.register": "Register",
  "auth.logout": "Logout",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.businessName": "Business Name",
  "auth.slugOptional": "Slug (optional)",
  "auth.submitting": "Submitting...",
  "auth.authenticated": "Authenticated",
  "auth.loggedOut": "Logged out",
  "auth.profileLoadFailed": "Authenticated, but profile is unavailable",
  "auth.requestVerification": "Request email verification",
  "auth.verifyEmail": "Verify email",
  "auth.verificationToken": "Verification token",
  "auth.verificationRequested": "Verification request sent",
  "auth.emailVerified": "Email verified"
};

const botIt: Dictionary = {
  "bot.greeting.formal": "Buongiorno. Come posso aiutarla con la prenotazione?"
};

const botEn: Dictionary = {
  "bot.greeting.formal": "Good day. How can I assist you with your booking?"
};

const notificationsIt: Dictionary = {
  "notifications.reminder.24h": "Promemoria: la sua prenotazione e prevista tra 24 ore.",
  "notifications.reminder.2h": "Promemoria: la sua prenotazione e prevista tra 2 ore."
};

const notificationsEn: Dictionary = {
  "notifications.reminder.24h": "Reminder: your booking is scheduled in 24 hours.",
  "notifications.reminder.2h": "Reminder: your booking is scheduled in 2 hours."
};

export const dictionaries: Record<SupportedLocale, Dictionary> = {
  it: {
    ...commonIt,
    ...adminIt,
    ...publicIt,
    ...authIt,
    ...botIt,
    ...notificationsIt
  },
  en: {
    ...commonEn,
    ...adminEn,
    ...publicEn,
    ...authEn,
    ...botEn,
    ...notificationsEn
  }
};

export function assertDictionaryParity(): {
  missingInIt: string[];
  missingInEn: string[];
} {
  const itKeys = new Set(Object.keys(dictionaries.it));
  const enKeys = new Set(Object.keys(dictionaries.en));

  const missingInIt = [...enKeys].filter((key) => !itKeys.has(key)).sort();
  const missingInEn = [...itKeys].filter((key) => !enKeys.has(key)).sort();

  return { missingInIt, missingInEn };
}
