export const ADMIN_BOOKINGS_CHANGED_EVENT = "gc-admin-bookings-changed";

export function emitAdminBookingsChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(ADMIN_BOOKINGS_CHANGED_EVENT));
}
