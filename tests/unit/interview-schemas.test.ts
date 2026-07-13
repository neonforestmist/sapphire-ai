import { describe, expect, it } from "vitest";

import {
  boardAnalysisInputSchema,
  reasoningStateSchema,
  transcriptSegmentSchema,
} from "@/lib/interview/schemas";
import { createDeterministicMockReasoning } from "@/lib/interview/mock-reasoning";
import { createRateLimiterAnalysisInput } from "@/lib/whiteboard/rate-limiter-fixture";

describe("interview schemas", () => {
  it("accepts the deterministic structured reasoning result", () => {
    const input = createRateLimiterAnalysisInput(false);
    const reasoning = createDeterministicMockReasoning(input);

    expect(reasoningStateSchema.parse(reasoning).contradictions).toHaveLength(1);
  });

  it("rejects unknown model-output fields", () => {
    const reasoning = createDeterministicMockReasoning(createRateLimiterAnalysisInput(false));

    expect(() => reasoningStateSchema.parse({ ...reasoning, rawModelOutput: "unsafe" })).toThrow();
  });

  it("rejects invalid confidence and ask probes without a question", () => {
    const reasoning = createDeterministicMockReasoning(createRateLimiterAnalysisInput(false));

    expect(() =>
      reasoningStateSchema.parse({ ...reasoning, analysisConfidence: 1.01 }),
    ).toThrow();
    expect(() =>
      reasoningStateSchema.parse({
        ...reasoning,
        recommendedProbe: { ...reasoning.recommendedProbe, question: null },
      }),
    ).toThrow(/question/i);
  });

  it("accepts finalized transcript timing and rejects reversed or interim segments", () => {
    const segment = createRateLimiterAnalysisInput(false).recentTranscript[0]!;
    expect(transcriptSegmentSchema.parse(segment)).toEqual(segment);
    expect(() =>
      transcriptSegmentSchema.parse({ ...segment, endedAt: segment.startedAt - 1 }),
    ).toThrow(/endedAt/);
    expect(() => transcriptSegmentSchema.parse({ ...segment, finalized: false })).toThrow();
  });

  it("rejects transcript windows from a different session", () => {
    const input = createRateLimiterAnalysisInput(false);
    expect(() =>
      boardAnalysisInputSchema.parse({
        ...input,
        recentTranscript: [{ ...input.recentTranscript[0]!, sessionId: "another-session" }],
      }),
    ).toThrow(/different session/i);
  });
});
