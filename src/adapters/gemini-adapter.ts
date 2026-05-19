import { GoogleGenAI } from "@google/genai";
import { ModelAdapter, ModelRequest, ModelResponse } from "./model-adapter.js";

export interface GeminiAdapterOptions {
  apiKey?: string;
  model?: string;
}

export class GeminiModelAdapter implements ModelAdapter {
  readonly id = "gemini";
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(options: GeminiAdapterOptions = {}) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey ?? process.env.GEMINI_API_KEY });
    this.model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: JSON.stringify(
        {
          taskId: request.taskId,
          objective: request.objective,
          input: request.input,
          context: request.context ?? "",
        },
        null,
        2,
      ),
      config: {
        systemInstruction:
          "You are a bounded worker inside an Agent Mesh Runtime. Return concise, structured JSON-compatible work products. Do not claim tool use you did not perform.",
      },
    });

    const rawText = response.text ?? "";
    return {
      rawText,
      output: {
        text: rawText,
      },
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
        totalTokens: response.usageMetadata?.totalTokenCount,
      },
    };
  }
}
