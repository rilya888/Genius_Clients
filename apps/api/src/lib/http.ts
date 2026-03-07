export type ApiMeta = {
  requestId?: string;
  pagination?: {
    limit: number;
    offset?: number;
    cursor?: string;
    nextCursor?: string;
  };
};

export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiSuccess<T> = {
  data: T;
  meta?: ApiMeta;
};

export type ApiFailure = {
  error: ApiErrorPayload;
  meta?: ApiMeta;
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(params: { code: string; message: string; status: number; details?: unknown }) {
    super(params.message);
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
  }
}

export const errorCatalog = {
  AUTH_UNAUTHORIZED: { status: 401, message: "Unauthorized" },
  AUTH_FORBIDDEN: { status: 403, message: "Forbidden" },
  AUTH_INVALID_CREDENTIALS: { status: 401, message: "Invalid credentials" },
  TENANT_NOT_FOUND: { status: 404, message: "Tenant not found" },
  CONFLICT: { status: 409, message: "Conflict" },
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD: {
    status: 409,
    message: "Idempotency key reused with different payload"
  },
  VALIDATION_ERROR: { status: 400, message: "Validation error" },
  RATE_LIMITED: { status: 429, message: "Too many requests" },
  INTERNAL_ERROR: { status: 500, message: "Internal error" }
} as const;

export function appError(code: keyof typeof errorCatalog, details?: unknown): AppError {
  const item = errorCatalog[code];
  return new AppError({ code, message: item.message, status: item.status, details });
}
