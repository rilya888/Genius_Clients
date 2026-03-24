import type { WhatsAppEndpointRow } from "../repositories/super-admin/channel-endpoint-repository";

export type WhatsAppSetupStatus =
  | "not_started"
  | "incomplete"
  | "numbers_provided"
  | "pending_meta_connection"
  | "connected"
  | "action_required";

export type WhatsAppSetupSummary = {
  desiredBotNumber: string | null;
  operatorNumber: string | null;
  status: WhatsAppSetupStatus;
  connectedEndpointId: string | null;
  connectedDisplayPhoneNumber: string | null;
  requiresAction: boolean;
  statusReason:
    | "missing_numbers"
    | "missing_operator_number"
    | "missing_bot_number"
    | "numbers_saved"
    | "pending_meta_connection"
    | "connected"
    | "bot_number_conflict"
    | "connected_endpoint_disabled"
    | "connected_endpoint_token_missing"
    | "connected_endpoint_token_error";
};

type ComputeInput = {
  desiredBotNumber: string | null;
  operatorNumber: string | null;
  endpoints: Array<
    Pick<
      WhatsAppEndpointRow,
      "id" | "bindingStatus" | "displayPhoneNumber" | "isActive"
    > & {
      tokenConfigured?: boolean;
      tokenHealthStatus?: "ok" | "error" | "unknown" | "missing";
    }
  >;
  hasBotNumberConflict?: boolean;
};

export function computeWhatsAppSetupSummary(input: ComputeInput): WhatsAppSetupSummary {
  const desiredBotNumber = normalizeNullableString(input.desiredBotNumber);
  const operatorNumber = normalizeNullableString(input.operatorNumber);
  const activeEndpoints = input.endpoints.filter((item) => item.isActive);
  const connectedEndpoint =
    activeEndpoints.find((item) => item.bindingStatus === "connected") ?? null;
  const pendingEndpoint =
    activeEndpoints.find(
      (item) => item.bindingStatus === "pending_verification" || item.bindingStatus === "draft"
    ) ?? null;
  const disabledEndpoint = activeEndpoints.find((item) => item.bindingStatus === "disabled") ?? null;

  if (!desiredBotNumber && !operatorNumber) {
    return buildSummary({
      desiredBotNumber,
      operatorNumber,
      status: "not_started",
      statusReason: "missing_numbers"
    });
  }

  if (!desiredBotNumber) {
    return buildSummary({
      desiredBotNumber,
      operatorNumber,
      status: "incomplete",
      statusReason: "missing_bot_number"
    });
  }

  if (!operatorNumber) {
    return buildSummary({
      desiredBotNumber,
      operatorNumber,
      status: "incomplete",
      statusReason: "missing_operator_number"
    });
  }

  if (input.hasBotNumberConflict) {
    return buildSummary({
      desiredBotNumber,
      operatorNumber,
      status: "action_required",
      statusReason: "bot_number_conflict"
    });
  }

  if (connectedEndpoint) {
    if (connectedEndpoint.tokenConfigured === false) {
      return buildSummary({
        desiredBotNumber,
        operatorNumber,
        status: "action_required",
        statusReason: "connected_endpoint_token_missing",
        connectedEndpoint
      });
    }
    if (connectedEndpoint.tokenHealthStatus === "error") {
      return buildSummary({
        desiredBotNumber,
        operatorNumber,
        status: "action_required",
        statusReason: "connected_endpoint_token_error",
        connectedEndpoint
      });
    }
    return buildSummary({
      desiredBotNumber,
      operatorNumber,
      status: "connected",
      statusReason: "connected",
      connectedEndpoint
    });
  }

  if (pendingEndpoint) {
    return buildSummary({
      desiredBotNumber,
      operatorNumber,
      status: "pending_meta_connection",
      statusReason: "pending_meta_connection",
      connectedEndpoint: pendingEndpoint
    });
  }

  if (disabledEndpoint) {
    return buildSummary({
      desiredBotNumber,
      operatorNumber,
      status: "action_required",
      statusReason: "connected_endpoint_disabled",
      connectedEndpoint: disabledEndpoint
    });
  }

  return buildSummary({
    desiredBotNumber,
    operatorNumber,
    status: "numbers_provided",
    statusReason: "numbers_saved"
  });
}

function buildSummary(input: {
  desiredBotNumber: string | null;
  operatorNumber: string | null;
  status: WhatsAppSetupStatus;
  statusReason: WhatsAppSetupSummary["statusReason"];
  connectedEndpoint?: {
    id: string;
    displayPhoneNumber: string | null;
  } | null;
}) {
  return {
    desiredBotNumber: input.desiredBotNumber,
    operatorNumber: input.operatorNumber,
    status: input.status,
    connectedEndpointId: input.connectedEndpoint?.id ?? null,
    connectedDisplayPhoneNumber: input.connectedEndpoint?.displayPhoneNumber ?? null,
    requiresAction: input.status === "action_required",
    statusReason: input.statusReason
  } satisfies WhatsAppSetupSummary;
}

function normalizeNullableString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
