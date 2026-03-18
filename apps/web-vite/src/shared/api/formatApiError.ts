import { ApiHttpError } from "./http";

export function formatApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiHttpError) {
    const detail = error.message.startsWith("HTTP_") ? fallbackMessage : error.message;
    return error.requestId ? `${detail} (requestId: ${error.requestId})` : detail;
  }
  return fallbackMessage;
}
