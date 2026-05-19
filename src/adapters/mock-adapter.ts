import { ModelAdapter, ModelRequest, ModelResponse } from "./model-adapter.js";

export class MockModelAdapter implements ModelAdapter {
  readonly id = "mock";

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const rawText = `Mock result for task ${request.taskId}: ${request.objective}`;
    return {
      rawText,
      output: {
        summary: rawText,
        input: request.input,
      },
    };
  }
}
