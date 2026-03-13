type ResponseFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type ResponseFunctionCallOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

type ResponseFunctionCall = {
  id?: string;
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

export type OpenAITurnType = "user_input" | "tool_output";

type ResponseUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

type ResponsePayload = {
  id?: string;
  output?: Array<Record<string, unknown>>;
  output_text?: string;
  usage?: ResponseUsage;
};

export type OpenAIResponseResult = {
  id?: string;
  outputText: string;
  functionCalls: ResponseFunctionCall[];
  usage: ResponseUsage | null;
};

export class OpenAIResponsesError extends Error {
  constructor(
    readonly code:
      | "openai_previous_response_not_found"
      | "openai_tool_chain_invalid"
      | "openai_transport_error",
    readonly status: number,
    readonly details: string
  ) {
    super(`${code}:${status}:${details.slice(0, 400)}`);
  }
}

export class OpenAIResponsesClient {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 15000
  ) {}

  async create(input: {
    model: string;
    instructions: string;
    input: string | ResponseFunctionCallOutput[];
    turnType: OpenAITurnType;
    tools?: ResponseFunctionTool[];
    previousResponseId?: string;
    metadata?: Record<string, string>;
  }): Promise<OpenAIResponseResult> {
    let response = await this.request(input);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      if (
        input.turnType === "user_input" &&
        input.previousResponseId &&
        response.status === 400 &&
        errorText.includes("previous_response_not_found")
      ) {
        response = await this.request({
          ...input,
          previousResponseId: undefined
        });
      } else if (
        input.turnType === "tool_output" &&
        response.status === 400 &&
        (errorText.includes("previous_response_not_found") ||
          errorText.includes("No tool call found for function call output"))
      ) {
        throw new OpenAIResponsesError("openai_tool_chain_invalid", response.status, errorText);
      } else {
        throw classifyOpenAIError(response.status, errorText);
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw classifyOpenAIError(response.status, errorText);
    }

    const payload = (await response.json()) as ResponsePayload;
    return {
      id: typeof payload.id === "string" ? payload.id : undefined,
      outputText: extractOutputText(payload),
      functionCalls: extractFunctionCalls(payload),
      usage: payload.usage ?? null
    };
  }

  private request(input: {
    model: string;
    instructions: string;
    input: string | ResponseFunctionCallOutput[];
    turnType: OpenAITurnType;
    tools?: ResponseFunctionTool[];
    previousResponseId?: string;
    metadata?: Record<string, string>;
  }) {
    return fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        instructions: input.instructions,
        input: input.input,
        tools: input.tools ?? [],
        previous_response_id: input.previousResponseId,
        metadata: input.metadata,
        store: false
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
  }
}

function classifyOpenAIError(status: number, errorText: string) {
  if (status === 400 && errorText.includes("previous_response_not_found")) {
    return new OpenAIResponsesError("openai_previous_response_not_found", status, errorText);
  }
  return new OpenAIResponsesError("openai_transport_error", status, errorText);
}

function extractOutputText(payload: ResponsePayload): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const textParts: string[] = [];

  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (
          typeof content === "object" &&
          content &&
          ((content as Record<string, unknown>).type === "output_text" ||
            (content as Record<string, unknown>).type === "text")
        ) {
          const value =
            (content as Record<string, unknown>).text ??
            ((content as Record<string, unknown>).content as string | undefined);
          if (typeof value === "string" && value.trim()) {
            textParts.push(value.trim());
          }
        }
      }
    }
  }

  return textParts.join("\n").trim();
}

function extractFunctionCalls(payload: ResponsePayload): ResponseFunctionCall[] {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const calls: ResponseFunctionCall[] = [];

  for (const item of output) {
    if (item.type !== "function_call") {
      continue;
    }
    const name = typeof item.name === "string" ? item.name : "";
    const callId = typeof item.call_id === "string" ? item.call_id : "";
    const args = typeof item.arguments === "string" ? item.arguments : "{}";
    if (!name || !callId) {
      continue;
    }
    calls.push({
      id: typeof item.id === "string" ? item.id : undefined,
      type: "function_call",
      call_id: callId,
      name,
      arguments: args
    });
  }

  return calls;
}
