import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelRequest } from "@capmap/core";

export const API_KEY_ENV_VAR = "ANTHROPIC_API_KEY";

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  static fromEnv(env: NodeJS.ProcessEnv): AnthropicModelClient {
    const key = env[API_KEY_ENV_VAR];
    if (key === undefined || key === "") {
      throw new Error(
        `${API_KEY_ENV_VAR} is not set; enrichment and matching require it`,
      );
    }
    return new AnthropicModelClient(key);
  }

  async complete(request: ModelRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
    });
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}
