import OpenAI from "openai";
import { ModelAdapter, ModelRequest, ModelResponse } from "./model-adapter.js";

export interface OpenAIAdapterOptions {
  apiKey?: string;
  model?: string;
}

export class OpenAIModelAdapter implements ModelAdapter {
  readonly id = "openai";
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIAdapterOptions = {}) {
    this.client = new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY });
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.4";
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        {
          role: "system",
          content:
            "You are a bounded worker inside an Agent Mesh Runtime. Return concise, structured JSON-compatible work products. Do not claim tool use you did not perform.",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              taskId: request.taskId,
              objective: request.objective,
              input: request.input,
              context: request.context ?? "",
            },
            null,
            2,
          ),
        },
      ],
    });

    const rawText = response.output_text ?? "";
    return {
      rawText,
      output: {
        text: rawText,
      },
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        totalTokens: response.usage?.total_tokens,
      },
    };
  }
}
