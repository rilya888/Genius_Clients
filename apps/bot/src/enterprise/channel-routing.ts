export type ChannelProvider = "whatsapp" | "telegram";

export type BotRoutingContext = {
  accountId: string;
  salonId: string;
  externalEndpointId?: string | null;
  tenantSlug?: string | null;
  tenantId?: string | null;
};

export type ResolveRouteInput = {
  apiUrl: string;
  internalApiSecret: string;
  provider: ChannelProvider;
  externalEndpointId: string;
};

export type ResolveRouteResult =
  | { ok: true; context: BotRoutingContext }
  | { ok: false; reason: "api_unconfigured" | "not_found" | "invalid_response" | "request_failed" };

export async function resolveChannelRouteFromApi(
  input: ResolveRouteInput
): Promise<ResolveRouteResult> {
  if (!input.apiUrl || !input.internalApiSecret) {
    return { ok: false, reason: "api_unconfigured" };
  }

  const endpoint = `${input.apiUrl}/api/v1/enterprise-v2/channel-routing/resolve`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": input.internalApiSecret,
        "x-csrf-token": "bot-internal"
      },
      body: JSON.stringify({
        provider: input.provider,
        externalEndpointId: input.externalEndpointId
      })
    });
  } catch {
    return { ok: false, reason: "request_failed" };
  }

  if (response.status === 404) {
    return { ok: false, reason: "not_found" };
  }
  if (!response.ok) {
    return { ok: false, reason: "request_failed" };
  }

  const payload = await response.json().catch(() => null);
  const accountId = payload?.data?.accountId;
  const salonId = payload?.data?.salonId;
  if (typeof accountId !== "string" || typeof salonId !== "string") {
    return { ok: false, reason: "invalid_response" };
  }

  return {
    ok: true,
    context: {
      accountId,
      salonId,
      externalEndpointId:
        typeof payload?.data?.externalEndpointId === "string"
          ? payload.data.externalEndpointId
          : null,
      tenantSlug: typeof payload?.data?.tenantSlug === "string" ? payload.data.tenantSlug : null,
      tenantId: typeof payload?.data?.tenantId === "string" ? payload.data.tenantId : null
    }
  };
}

export function resolveLegacyBotRoute(input: {
  tenantSlug?: string;
  tenantId?: string;
}): BotRoutingContext | null {
  const tenantSlug = input.tenantSlug?.trim();
  const tenantId = input.tenantId?.trim();
  if (!tenantSlug && !tenantId) {
    return null;
  }

  return {
    accountId: tenantId || tenantSlug || "legacy-account",
    salonId: tenantId || tenantSlug || "legacy-salon",
    externalEndpointId: null,
    tenantSlug: tenantSlug || null,
    tenantId: tenantId || null
  };
}
