import type { BotRoutingContext } from "./channel-routing";

export function getRoutingScopeSegment(context: BotRoutingContext): string {
  if (context.salonId) {
    return `salon:${context.salonId}`;
  }
  if (context.tenantSlug) {
    return `slug:${context.tenantSlug}`;
  }
  if (context.tenantId) {
    return `tenant:${context.tenantId}`;
  }
  return "unknown";
}

export function buildScopedSessionKey(input: {
  context: BotRoutingContext;
  provider: "whatsapp" | "telegram";
  identity: string;
}) {
  return `${input.provider}:session:${getRoutingScopeSegment(input.context)}:${input.identity}`;
}
