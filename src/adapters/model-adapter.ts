import { JsonValue } from "../protocol/index.js";

export interface ModelRequest {
  taskId: string;
  objective: string;
  input: JsonValue;
  context?: string;
}

export interface ModelResponse {
  output: JsonValue;
  rawText: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface ModelAdapter {
  id: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}
