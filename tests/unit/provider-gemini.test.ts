import type { GoogleGenAI } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  boardAnalysisInputSchema,
  finalReportInputSchema,
  interviewSessionSchema,
  reasoningStateSchema,
  sessionCreatedEventSchema,
  type BoardAnalysisInput,
} from "@/lib/interview/schemas";
import { createStructuredInteraction } from "@/lib/gemini/interactions";
import { MockGeminiGateway } from "@/lib/gemini/mock-gateway";
import { RealGeminiGateway } from "@/lib/gemini/real-gateway";
import { sanitizeReasoningState } from "@/lib/gemini/sanitize";
import type { StructuredLogger } from "@/lib/security/logging";

function element(
  id: string,
  text: string | null,
  connectedFromIds: string[] = [],
  connectedToIds: string[] = [],
) {
  return {
    id,
    type: connectedFromIds.length + connectedToIds.length > 0 ? "arrow" as const : "rectangle" as const,
    text,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    angle: 0,
    deleted: false,
    groupIds: [],
    connectedFromIds,
    connectedToIds,
    updatedAt: 1,
  };
}

function analysisInput(
  elements: ReturnType<typeof element>[],
  previousReasoningState: BoardAnalysisInput["previousReasoningState"] = null,
): BoardAnalysisInput {
  return boardAnalysisInputSchema.parse({
    requestId: "request-1",
    sessionId: "session-1",
    analysisVersion: previousReasoningState ? 2 : 1,
    snapshotId: previousReasoningState ? "snapshot-2" : "snapshot-1",
    problemStatement: "Design a globally distributed API rate limiter.",
    boardImage: null,
    scene: { elements, capturedAt: 1 },
    diff: {
      addedElementIds: elements.map((candidate) => candidate.id),
      removedElementIds: [],
      changedElementIds: [],
      addedConnections: [],
      removedConnections: [],
      changedText: [],
      isMeaningful: true,
    },
    previousReasoningState,
    currentStage: "SOLUTION_CONSTRUCTION",
    recentTranscript: [
      {
        id: "transcript-global",
        sessionId: "session-1",
        speaker: "candidate",
        source: "text",
        text: "The quota must remain globally consistent.",
        startedAt: 1,
        endedAt: 2,
        finalized: true,
      },
    ],
    olderSessionSummary: "",
    hiddenRubric: ["Address global versus regional consistency."],
    activeConstraints: [],
  });
}

function realGateway(create: ReturnType<typeof vi.fn>, maximumTransientRetries: 0 | 1 = 0) {
  const client = { interactions: { create } } as unknown as GoogleGenAI;
  const logger: StructuredLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    gateway: new RealGeminiGateway({
      apiKey: "test-only-key",
      reasoningModel: "gemini-3.5-flash",
      liveModel: "gemini-3.1-flash-live-preview",
      requestTimeoutMs: 1_000,
      maximumTransientRetries,
      contradictionThreshold: 0.72,
      interactionClient: client,
      liveTokenClient: client,
      logger,
      now: () => new Date(1_000),
    }),
    logger,
  };
}

describe("deterministic Gemini mock", () => {
  it("detects the flagship contradiction and returns exact known store IDs", async () => {
    const input = analysisInput([
      element("us-store", "US Redis"),
      element("eu-store", "EU Redis"),
    ]);
    const result = await new MockGeminiGateway(() => 100).analyzeBoard(input);

    expect(result.contradictions[0]?.id).toBe("contradiction-global-consistency");
    expect(result.recommendedProbe.focusElementIds).toEqual(["us-store", "eu-store"]);
    expect(result.recommendedProbe.question).toMatch(/one shared limit/i);
  });

  it("recognizes a synchronization revision after the contradiction", async () => {
    const gateway = new MockGeminiGateway(() => 100);
    const initial = analysisInput([
      element("us-store", "US Redis"),
      element("eu-store", "EU Redis"),
    ]);
    const mismatch = await gateway.analyzeBoard(initial);
    const revised = analysisInput([
      element("us-store", "US Redis"),
      element("eu-store", "EU Redis"),
      element("sync", "Global synchronization"),
      element("arrow-us-sync", null, ["us-store"], ["sync"]),
      element("arrow-sync-eu", null, ["sync"], ["eu-store"]),
    ], mismatch);

    const result = await gateway.analyzeBoard(revised);
    expect(result.contradictions).toEqual([]);
    expect(result.observations.some((observation) => observation.category === "revision")).toBe(true);
    expect(result.updatedCompetencySignals).toContainEqual(
      expect.objectContaining({ competency: "adaptability", sentiment: "strength" }),
    );
  });
});

describe("real interaction boundary", () => {
  it("uses the deterministic flagship blueprint in demo mode to preserve analysis quota", async () => {
    const create = vi.fn();
    const { gateway, logger } = realGateway(create);

    const blueprint = await gateway.createInterviewBlueprint({
      scenarioId: "global-rate-limiter",
      mode: "demo",
    });

    expect(blueprint.problemStatement).toBe("Give an AI study helper one shared usage limit.");
    expect(blueprint.hiddenRubric).toContain("Address global versus regional consistency.");
    expect(create).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "gemini.blueprint.deterministic_demo",
      { scenarioId: "global-rate-limiter" },
    );
  });

  it("falls back to a validated evidence report after a transient provider failure", async () => {
    const create = vi.fn().mockRejectedValue({ status: 500 });
    const { gateway, logger } = realGateway(create);
    const blueprint = await new MockGeminiGateway(() => 1_000).createInterviewBlueprint({
      scenarioId: "global-rate-limiter",
      mode: "demo",
    });
    const session = interviewSessionSchema.parse({
      id: "session-1",
      scenarioId: "global-rate-limiter",
      mode: "demo",
      stage: "GENERATING_REPORT",
      status: "generating_report",
      createdAt: 1,
      updatedAt: 2,
      latestAnalysisVersion: 0,
    });
    const event = sessionCreatedEventSchema.parse({
      id: "event-1",
      sessionId: session.id,
      sequence: 1,
      occurredAt: 1,
      type: "session.created",
      payload: {
        scenarioId: session.scenarioId,
        mode: session.mode,
        initialStage: "SETUP",
      },
    });
    const input = finalReportInputSchema.parse({
      session,
      blueprint,
      events: [event],
      snapshots: [],
      finalReasoningState: null,
    });

    const report = await gateway.generateFinalReport(input);

    expect(report.sessionId).toBe(session.id);
    expect(report.limitations).toContain(
      "Gemini final-report generation was temporarily unavailable. This report was assembled from validated session evidence.",
    );
    expect(report.limitations.join(" ")).not.toMatch(/mock mode/i);
    expect(create).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      "gemini.report.deterministic_fallback",
      expect.objectContaining({ model: "gemini-3.5-flash" }),
    );
  });

  it("uses the current Interactions request shape and repairs invalid JSON once", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: "interaction-1", status: "completed", output_text: "not-json" })
      .mockResolvedValueOnce({ id: "interaction-2", status: "completed", output_text: '{"answer":"ok"}' });
    const client = { interactions: { create } } as unknown as GoogleGenAI;
    const schema = z.object({ answer: z.string() }).strict();

    const result = await createStructuredInteraction({
      client,
      model: "gemini-3.5-flash",
      systemInstruction: "Return JSON.",
      input: [{ type: "text", text: "Analyze." }],
      schema,
      schemaName: "Answer",
      requestId: "request-1",
      timeoutMs: 1_000,
      maximumTransientRetries: 1,
      sleep: async () => undefined,
    });

    expect(result).toMatchObject({ value: { answer: "ok" }, repaired: true, attempts: 2 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: "gemini-3.5-flash",
      system_instruction: "Return JSON.",
      response_format: { type: "text", mime_type: "application/json" },
      generation_config: { thinking_level: "medium", max_output_tokens: 4_096 },
      store: false,
    });
  });

  it("allows only one transient provider retry", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ id: "interaction-2", status: "completed", output_text: '{"answer":"ok"}' });
    const client = { interactions: { create } } as unknown as GoogleGenAI;
    const sleep = vi.fn(async () => undefined);

    const result = await createStructuredInteraction({
      client,
      model: "gemini-3.5-flash",
      systemInstruction: "Return JSON.",
      input: "Analyze.",
      schema: z.object({ answer: z.string() }).strict(),
      schemaName: "Answer",
      requestId: "request-1",
      timeoutMs: 1_000,
      maximumTransientRetries: 1,
      sleep,
    });

    expect(result.attempts).toBe(2);
    expect(sleep).toHaveBeenCalledOnce();
  });
});

describe("reasoning-state safety", () => {
  it("removes unknown element IDs and downgrades an ungrounded assertion", () => {
    const input = analysisInput([element("us-store", "US Redis"), element("eu-store", "EU Redis")]);
    const unsafe = reasoningStateSchema.parse({
      boardSummary: "Summary",
      candidateApproachSummary: "Approach",
      observations: [],
      contradictions: [
        {
          id: "contradiction-1",
          description: "Claim",
          spokenClaim: "Global consistency",
          boardInterpretation: "Unknown evidence",
          whyItMatters: "Quota issue",
          evidence: {
            transcriptSegmentIds: ["transcript-global"],
            boardElementIds: ["invented-id"],
            snapshotId: "snapshot-1",
          },
          confidence: 0.99,
        },
      ],
      unresolvedQuestions: [],
      updatedCompetencySignals: [],
      recommendedProbe: {
        action: "ask",
        question: "This is definitely wrong, yes?",
        reason: "Asserted mismatch",
        focusElementIds: ["invented-id"],
        urgency: "interrupt",
        confidence: 0.99,
      },
      analysisConfidence: 0.99,
    });

    const result = sanitizeReasoningState(unsafe, input, 0.72);
    expect(result.contradictions).toEqual([]);
    expect(result.recommendedProbe.focusElementIds).toEqual([]);
    expect(result.recommendedProbe.question).toMatch(/clarify/i);
  });
});
