import { describe, expect, it } from "vitest";

import { createDeterministicMockReasoning } from "@/lib/interview/mock-reasoning";
import {
  UnknownBoardElementIdError,
  enforceReasoningConfidenceThreshold,
  sanitizeBoardElementIds,
  sanitizeReasoningStateElementIds,
} from "@/lib/interview/reasoning-safety";
import {
  RATE_LIMITER_IDS,
  RATE_LIMITER_INITIAL_SCENE,
  createRateLimiterAnalysisInput,
} from "@/lib/whiteboard/rate-limiter-fixture";

describe("reasoning board-ID safety", () => {
  it("deduplicates known IDs and filters malformed, unknown, and deleted IDs", () => {
    const scene = {
      ...RATE_LIMITER_INITIAL_SCENE,
      elements: RATE_LIMITER_INITIAL_SCENE.elements.map((element) =>
        element.id === RATE_LIMITER_IDS.euRedis ? { ...element, deleted: true } : element,
      ),
    };
    const result = sanitizeBoardElementIds(
      [RATE_LIMITER_IDS.usRedis, RATE_LIMITER_IDS.usRedis, RATE_LIMITER_IDS.euRedis, "invented-id", "bad id"],
      scene,
    );

    expect(result.validIds).toEqual([RATE_LIMITER_IDS.usRedis]);
    expect(result.unknownIds).toEqual([
      RATE_LIMITER_IDS.euRedis,
      "invented-id",
      "bad id",
    ]);
  });

  it("drops unverifiable contradictions and suppresses their probe", () => {
    const reasoning = createDeterministicMockReasoning(createRateLimiterAnalysisInput(false));
    const unsafe = {
      ...reasoning,
      contradictions: reasoning.contradictions.map((contradiction) => ({
        ...contradiction,
        evidence: {
          ...contradiction.evidence,
          boardElementIds: [...contradiction.evidence.boardElementIds, "invented-store"],
        },
      })),
      recommendedProbe: {
        ...reasoning.recommendedProbe,
        focusElementIds: [...reasoning.recommendedProbe.focusElementIds, "invented-store"],
      },
    };

    const result = sanitizeReasoningStateElementIds(unsafe, RATE_LIMITER_INITIAL_SCENE);

    expect(result.removedElementIds).toEqual(["invented-store"]);
    expect(result.droppedContradictionIds).toEqual([
      "contradiction-global-vs-regional-state",
    ]);
    expect(result.probeSuppressed).toBe(true);
    expect(result.state.contradictions).toEqual([]);
    expect(result.state.recommendedProbe).toMatchObject({
      action: "wait",
      question: null,
      focusElementIds: [],
      urgency: "wait",
    });
  });

  it("can reject the whole model result instead of filtering", () => {
    const reasoning = createDeterministicMockReasoning(createRateLimiterAnalysisInput(false));
    const unsafe = {
      ...reasoning,
      recommendedProbe: {
        ...reasoning.recommendedProbe,
        focusElementIds: ["invented-store"],
      },
    };

    expect(() =>
      sanitizeReasoningStateElementIds(unsafe, RATE_LIMITER_INITIAL_SCENE, "reject"),
    ).toThrow(UnknownBoardElementIdError);
  });

  it("leaves a fully grounded result unchanged", () => {
    const reasoning = createDeterministicMockReasoning(createRateLimiterAnalysisInput(false));
    const result = sanitizeReasoningStateElementIds(reasoning, RATE_LIMITER_INITIAL_SCENE);

    expect(result).toEqual({
      state: reasoning,
      removedElementIds: [],
      droppedContradictionIds: [],
      probeSuppressed: false,
    });
  });

  it("turns a low-confidence contradiction into a neutral clarification", () => {
    const reasoning = createDeterministicMockReasoning(createRateLimiterAnalysisInput(false));
    const uncertain = {
      ...reasoning,
      analysisConfidence: 0.6,
      contradictions: reasoning.contradictions.map((contradiction) => ({
        ...contradiction,
        confidence: 0.6,
      })),
      recommendedProbe: { ...reasoning.recommendedProbe, confidence: 0.6 },
    };

    const result = enforceReasoningConfidenceThreshold(uncertain);
    expect(result.suppressedContradictionIds).toEqual([
      "contradiction-global-vs-regional-state",
    ]);
    expect(result.state.contradictions).toEqual([]);
    expect(result.state.recommendedProbe.question).toMatch(/walk me through/i);
    expect(result.probeDowngraded).toBe(true);
  });
});
