import { describe, it, expect } from "vitest";
import {
  AnthropicModelClient,
  API_KEY_ENV_VAR,
} from "../../src/adapters/anthropic-client.js";

describe("AnthropicModelClient.fromEnv", () => {
  it("refuses when the credential is absent, naming the variable", () => {
    expect(() => AnthropicModelClient.fromEnv({})).toThrow(
      new RegExp(API_KEY_ENV_VAR),
    );
  });

  it("refuses an empty credential rather than sending it", () => {
    // An empty string is a configuration mistake that would otherwise surface
    // as a confusing 401 from the far end, long after the cause.
    expect(() =>
      AnthropicModelClient.fromEnv({ [API_KEY_ENV_VAR]: "" }),
    ).toThrow(new RegExp(API_KEY_ENV_VAR));
  });

  it("constructs when a credential is present, without contacting anything", () => {
    const client = AnthropicModelClient.fromEnv({
      [API_KEY_ENV_VAR]: "sk-ant-test-not-a-real-key",
    });
    expect(client).toBeInstanceOf(AnthropicModelClient);
  });
});

/**
 * CM-14: this used to test a local copy of the extraction code, so the real
 * client could change without a test noticing, and a request field (`effort`)
 * was accepted by every caller and never sent. These drive the real class
 * through an injected messages API.
 */
describe("AnthropicModelClient request and response", () => {
  function recordingApi(content: Array<{ type: string; text?: string }>) {
    const sent: Array<Record<string, unknown>> = [];
    return {
      sent,
      messages: {
        create: async (body: Record<string, unknown>) => {
          sent.push(body);
          return { content };
        },
      },
    };
  }

  const request = { system: "sys", user: "hello", model: "claude-x", maxTokens: 77 };

  it("sends every field of the request it is given", async () => {
    const api = recordingApi([{ type: "text", text: "ok" }]);
    await new AnthropicModelClient(api as never).complete(request);
    expect(api.sent).toEqual([
      {
        model: "claude-x",
        max_tokens: 77,
        system: "sys",
        messages: [{ role: "user", content: "hello" }],
      },
    ]);
    expect(Object.keys(request).sort()).toEqual(["maxTokens", "model", "system", "user"]);
  });

  it("joins consecutive text blocks", async () => {
    const api = recordingApi([
      { type: "text", text: '{"summary":' },
      { type: "text", text: '"x"}' },
    ]);
    expect(await new AnthropicModelClient(api as never).complete(request)).toBe('{"summary":"x"}');
  });

  it("drops non-text blocks, and yields an empty string when none is text", async () => {
    const mixed = recordingApi([{ type: "thinking" }, { type: "text", text: "kept" }, { type: "tool_use" }]);
    expect(await new AnthropicModelClient(mixed as never).complete(request)).toBe("kept");
    const none = recordingApi([{ type: "thinking" }]);
    expect(await new AnthropicModelClient(none as never).complete(request)).toBe("");
  });
});
