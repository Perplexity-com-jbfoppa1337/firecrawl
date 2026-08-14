import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { describe, expect, it } from "vitest";

import { config } from "../config";

/**
 * Perplexity Gateway is OpenAI-compatible, so it plugs into `createOpenAI`
 * via `baseURL`. These tests verify the wiring — base URL, auth header, and
 * model slug — without hitting the network. See:
 *   https://docs.perplexity.ai/docs/gateway/quickstart
 *   https://docs.perplexity.ai/api-reference/gateway-chat-completions-post
 *
 * We can't just import `getModel` and mock its dependencies because
 * `config` is validated at module load. Instead we reconstruct the provider
 * with the exact call shape used in generic-ai.ts and inject a fetch spy.
 */
describe("Perplexity Gateway provider wiring", () => {
  it("targets the Gateway base URL by default", () => {
    // Sanity-check the config surface stays in sync with the docs.
    expect(config.PERPLEXITY_GATEWAY_BASE_URL).toBe(
      "https://api.perplexity.ai/router/v1",
    );
  });

  it("posts to /chat/completions with bearer auth and the requested model slug", async () => {
    const captured: {
      url?: string;
      authorization?: string | null;
      body?: any;
    } = {};

    const fakeFetch: typeof fetch = async (input, init) => {
      captured.url = typeof input === "string" ? input : (input as Request).url;
      const headers = new Headers(init?.headers);
      captured.authorization = headers.get("authorization");
      captured.body = init?.body ? JSON.parse(init.body as string) : undefined;

      // Minimal non-streaming Chat Completions response body.
      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: captured.body?.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok", annotations: [] },
              logprobs: null,
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const provider = createOpenAI({
      apiKey: "test-key",
      baseURL: "https://api.perplexity.ai/router/v1",
      fetch: fakeFetch,
    });

    await generateText({
      model: provider.chat("anthropic/claude-sonnet-5"),
      prompt: "ping",
    });

    expect(captured.url).toBe(
      "https://api.perplexity.ai/router/v1/chat/completions",
    );
    expect(captured.authorization).toBe("Bearer test-key");
    expect(captured.body?.model).toBe("anthropic/claude-sonnet-5");
    expect(Array.isArray(captured.body?.messages)).toBe(true);
  });
});
