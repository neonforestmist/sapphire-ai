import { describe, expect, it } from "vitest";

import { createDeterministicMockReasoning } from "@/lib/interview/mock-reasoning";
import {
  RATE_LIMITER_IDS,
  createRateLimiterAnalysisInput,
} from "@/lib/whiteboard/rate-limiter-fixture";

describe("deterministic rate-limiter reasoning", () => {
  it("detects the spoken/board mismatch and focuses the exact regional stores", () => {
    const reasoning = createDeterministicMockReasoning(createRateLimiterAnalysisInput(false));

    expect(reasoning.contradictions).toHaveLength(1);
    expect(reasoning.contradictions[0]).toMatchObject({
      id: "contradiction-global-vs-regional-state",
      spokenClaim: expect.stringMatching(/globally consistent/i),
      evidence: {
        transcriptSegmentIds: [RATE_LIMITER_IDS.globalClaimTranscript],
        boardElementIds: [RATE_LIMITER_IDS.usRedis, RATE_LIMITER_IDS.euRedis],
        snapshotId: RATE_LIMITER_IDS.initialSnapshot,
      },
    });
    expect(reasoning.recommendedProbe.focusElementIds).toEqual([
      RATE_LIMITER_IDS.usRedis,
      RATE_LIMITER_IDS.euRedis,
    ]);
    expect(reasoning.recommendedProbe.question).toMatch(/both regions/i);
  });

  it("recognizes the coordinator revision while preserving original element IDs", () => {
    const initial = createDeterministicMockReasoning(createRateLimiterAnalysisInput(false));
    const revisedInput = createRateLimiterAnalysisInput(true, initial);
    const revised = createDeterministicMockReasoning(revisedInput);

    expect(revisedInput.scene.elements.map((element) => element.id)).toEqual(
      expect.arrayContaining([
        RATE_LIMITER_IDS.usRedis,
        RATE_LIMITER_IDS.euRedis,
        RATE_LIMITER_IDS.coordinator,
      ]),
    );
    expect(revised.contradictions).toEqual([]);
    expect(revised.observations).toContainEqual(
      expect.objectContaining({
        id: "observation-coordination-revision",
        category: "revision",
        evidence: expect.objectContaining({
          boardElementIds: [
            RATE_LIMITER_IDS.usRedis,
            RATE_LIMITER_IDS.euRedis,
            RATE_LIMITER_IDS.coordinator,
          ],
        }),
      }),
    );
    expect(revised.recommendedProbe.action).toBe("wait");
  });

  it("asks a neutral requirement question when the global claim is absent", () => {
    const input = { ...createRateLimiterAnalysisInput(false), recentTranscript: [] };
    const reasoning = createDeterministicMockReasoning(input);

    expect(reasoning.contradictions).toEqual([]);
    expect(reasoning.recommendedProbe).toMatchObject({
      action: "ask",
      question: expect.stringMatching(/consistency semantics/i),
    });
  });
});
