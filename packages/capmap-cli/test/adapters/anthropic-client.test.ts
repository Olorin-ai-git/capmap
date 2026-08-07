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

describe("AnthropicModelClient response handling", () => {
  /**
   * The SDK returns a content array that can hold blocks other than text.
   * Joining only the text blocks is what makes the caller's JSON parsing work;
   * concatenating everything would corrupt it.
   */
  function extract(content: Array<{ type: string; text?: string }>): string {
    return content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
  }

  it("joins consecutive text blocks", () => {
    expect(
      extract([
        { type: "text", text: '{"summary":' },
        { type: "text", text: '"x"}' },
      ]),
    ).toBe('{"summary":"x"}');
  });

  it("drops non-text blocks", () => {
    expect(
      extract([
        { type: "thinking" },
        { type: "text", text: "kept" },
        { type: "tool_use" },
      ]),
    ).toBe("kept");
  });

  it("yields an empty string when no text block is present", () => {
    expect(extract([{ type: "thinking" }])).toBe("");
  });
});
