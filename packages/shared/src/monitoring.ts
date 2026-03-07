type CaptureContext = Record<string, unknown>;

function parseSentryDsn(dsn: string) {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.split("/").filter(Boolean).at(-1);
    if (!publicKey || !projectId) {
      return null;
    }
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/store/?sentry_version=7&sentry_key=${encodeURIComponent(publicKey)}`
    };
  } catch {
    return null;
  }
}

export async function captureException(input: {
  service: string;
  error: unknown;
  context?: CaptureContext;
}) {
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);
  const stack = input.error instanceof Error ? input.error.stack : undefined;
  const payload = {
    message: `[${input.service}] ${errorMessage}`,
    level: "error",
    platform: "node",
    timestamp: Math.floor(Date.now() / 1000),
    logger: input.service,
    extra: {
      context: input.context ?? {},
      stack
    }
  };

  console.error(`[${input.service}] captured exception`, payload);

  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    return { reported: false as const, reason: "sentry_dsn_missing" as const };
  }

  const parsed = parseSentryDsn(dsn);
  if (!parsed) {
    return { reported: false as const, reason: "invalid_sentry_dsn" as const };
  }

  try {
    const response = await fetch(parsed.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    return {
      reported: response.ok as boolean,
      reason: response.ok ? ("ok" as const) : ("sentry_request_failed" as const)
    };
  } catch {
    return { reported: false as const, reason: "sentry_request_error" as const };
  }
}
