/**
 * Perplexity Gateway smoke test.
 *
 * Verifies that `getModel(..., "perplexity_gateway")` reaches
 *   POST https://api.perplexity.ai/router/v1/chat/completions
 * with a real API key, prints only the HTTP status and top-level response
 * shape, and NEVER prints the API key.
 *
 * The key is read from PERPLEXITY_API_KEY. If it is missing the script tells
 * the operator to create one in the API Console (https://console.perplexity.ai)
 * and export it in their own terminal. The key is never asked for at runtime
 * and never logged.
 *
 * Docs: https://docs.perplexity.ai/docs/gateway/quickstart
 *       https://docs.perplexity.ai/api-reference/gateway-chat-completions-post
 *       https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers
 *
 * Usage:
 *   PERPLEXITY_API_KEY=... pnpm tsx utils/perplexity-gateway-smoketest.ts
 *   # optional: pick a specific model slug from GET /router/v1/models
 *   PERPLEXITY_API_KEY=... PERPLEXITY_MODEL=perplexity/kimi-k3 \
 *     pnpm tsx utils/perplexity-gateway-smoketest.ts
 */

import { generateText } from "ai";
import { getModel } from "../src/lib/generic-ai";

async function main() {
  if (!process.env.PERPLEXITY_API_KEY) {
    console.error(
      [
        "PERPLEXITY_API_KEY is not set.",
        "Create a key at https://console.perplexity.ai and export it in your",
        "own terminal, e.g.:",
        "  export PERPLEXITY_API_KEY=pplx-...",
        "Then re-run this script. Never paste the key into a chat.",
      ].join("\n"),
    );
    process.exit(2);
  }

  // Default to a small, cheap catalog model. Any slug from
  // GET /router/v1/models works; unlisted slugs return 400.
  const modelId = process.env.PERPLEXITY_MODEL ?? "perplexity/kimi-k3";

  // Retry once on 429 honoring Retry-After. The Vercel AI SDK surfaces the
  // status on APICallError; we re-invoke after sleeping.
  const attempt = async () => {
    return generateText({
      model: getModel(modelId, "perplexity_gateway"),
      prompt: "Reply with the single word: pong",
      maxOutputTokens: 16,
    });
  };

  let result;
  try {
    result = await attempt();
  } catch (err: any) {
    const status = err?.statusCode ?? err?.status;
    if (status === 429) {
      const retryAfterRaw = err?.responseHeaders?.["retry-after"];
      const retryAfter = Number(retryAfterRaw);
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000;
      console.error(
        `Got 429 rate_limit_error. Honoring Retry-After (${
          Number.isFinite(retryAfter) ? `${retryAfter}s` : "default 2s"
        }) and retrying once.`,
      );
      await new Promise(r => setTimeout(r, waitMs));
      result = await attempt();
    } else if (status === 401) {
      console.error(
        "Got 401. Your PERPLEXITY_API_KEY is invalid or revoked — rotate it in " +
          "the API Console at https://console.perplexity.ai.",
      );
      process.exit(1);
    } else {
      throw err;
    }
  }

  // Print only shape and status, never the key.
  console.log("status: 200");
  console.log(
    JSON.stringify(
      {
        provider: "perplexity_gateway",
        model: modelId,
        response_shape: {
          hasText: typeof result.text === "string" && result.text.length > 0,
          finishReason: result.finishReason,
          usage: {
            inputTokens: result.usage?.inputTokens,
            outputTokens: result.usage?.outputTokens,
            totalTokens: result.usage?.totalTokens,
          },
        },
      },
      null,
      2,
    ),
  );
}

main().catch(err => {
  // Do NOT print the key. Only surface message + status.
  console.error(
    JSON.stringify(
      {
        error: err?.message ?? String(err),
        status: err?.statusCode ?? err?.status,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
