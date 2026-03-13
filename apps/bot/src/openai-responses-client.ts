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

export class OpenAIResponsesClient {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 15000
  ) {}

  async create(input: {
    model: string;
    instructions: string;
    input: string | ResponseFunctionCallOutput[];
    tools?: ResponseFunctionTool[];
    previousResponseId?: string;
    metadata?: Record<string, string>;
  }): Promise<OpenAIResponseResult> {
    let response = await this.request(input);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      if (
        input.previousResponseId &&
        response.status === 400 &&
        errorText.includes("previous_response_not_found")
      ) {
        response = await this.request({
          ...input,
          previousResponseId: undefined
        });
      } else {
        throw new Error(`openai_responses_failed:${response.status}:${errorText.slice(0, 400)}`);
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`openai_responses_failed:${response.status}:${errorText.slice(0, 400)}`);
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
