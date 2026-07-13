import { createRealGeminiGateway } from "@/lib/gemini/real-gateway";
import { reasoningStateSchema } from "@/lib/interview/schemas";
import { parseServerEnvironment } from "@/lib/security/env";
import {
  createRateLimiterAnalysisInput,
  RATE_LIMITER_IDS,
} from "@/lib/whiteboard/rate-limiter-fixture";

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not set. This opt-in smoke test never runs without an explicit server-side credential.",
    );
  }

  const environment = parseServerEnvironment({
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? "development",
    GEMINI_MODE: "real",
  });
  const gateway = createRealGeminiGateway(environment);
  const input = createRateLimiterAnalysisInput(false);
  const reasoning = reasoningStateSchema.parse(await gateway.analyzeBoard(input));
  const knownIds = new Set(input.scene.elements.map((element) => element.id));
  const focusIds = reasoning.recommendedProbe.focusElementIds;
  const relevantIds = new Set<string>([
    RATE_LIMITER_IDS.usRedis,
    RATE_LIMITER_IDS.euRedis,
  ]);

  if (focusIds.some((id) => !knownIds.has(id))) {
    throw new Error("The sanitized response contains an unknown board element ID.");
  }
  if (!focusIds.some((id) => relevantIds.has(id))) {
    throw new Error("The response did not focus either relevant regional quota store.");
  }
  const probe = reasoning.recommendedProbe.question?.toLowerCase() ?? "";
  if (!/(consisten|quota|region|shared|synchron)/.test(probe)) {
    throw new Error("The probe did not address or clarify the regional consistency mismatch.");
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      model: environment.geminiReasoningModel,
      focusElementIds: focusIds,
      contradictionCount: reasoning.contradictions.length,
    })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Real Gemini smoke test failed."}\n`);
  process.exitCode = 1;
});
