import { describe, expect, it } from "vitest";

import { MockGeminiGateway } from "@/lib/gemini/mock-gateway";
import {
  InMemorySessionRepository,
  InMemorySnapshotRepository,
} from "@/lib/persistence/memory";
import { parseServerEnvironment } from "@/lib/security/env";
import { createSapphireServerRuntime } from "@/lib/server/runtime";
import { SapphireInterviewService } from "@/lib/server/service";
import {
  RATE_LIMITER_GLOBAL_CLAIM,
  RATE_LIMITER_IDS,
  RATE_LIMITER_INITIAL_DIFF,
  RATE_LIMITER_INITIAL_SCENE,
  RATE_LIMITER_REVISION_DIFF,
  RATE_LIMITER_REVISED_SCENE,
} from "@/lib/whiteboard/rate-limiter-fixture";

function testService() {
  let now = 1_800_000_000_000;
  const environment = parseServerEnvironment({
    NODE_ENV: "test",
    GEMINI_MODE: "mock",
    ENABLE_GEMINI_LIVE: "false",
    ENABLE_FIRESTORE: "false",
    ENABLE_CLOUD_STORAGE: "false",
    SESSION_SIGNING_SECRET: "test-only-session-signing-secret-with-32-bytes",
  });
  const runtime = createSapphireServerRuntime({
    environment,
    gemini: new MockGeminiGateway(() => now),
    persistence: {
      sessions: new InMemorySessionRepository(),
      snapshots: new InMemorySnapshotRepository(),
      mode: "memory",
    },
    now: () => now,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return {
    runtime,
    service: new SapphireInterviewService(runtime),
    advance(milliseconds = 1_000) {
      now += milliseconds;
      return now;
    },
    now: () => now,
  };
}

describe("Sapphire interview server orchestration", () => {
  it("persists the exact contradiction, revision, evidence report, and deletion flow", async () => {
    const harness = testService();
    const created = await harness.service.createInterview({
      scenarioId: "global-rate-limiter",
      mode: "demo",
      inputMode: "text",
      consent: { transcript: true, microphone: false },
    });
    expect(created.session.stage).toBe("SOLUTION_CONSTRUCTION");
    expect(created.providerMode).toBe("mock");

    const transcriptTime = harness.advance();
    await harness.service.appendTranscript(created.session.id, {
      type: "transcript.input.finalized",
      segment: {
        id: RATE_LIMITER_IDS.globalClaimTranscript,
        sessionId: created.session.id,
        speaker: "candidate",
        source: "text",
        text: RATE_LIMITER_GLOBAL_CLAIM,
        startedAt: transcriptTime - 500,
        endedAt: transcriptTime,
        finalized: true,
      },
    });

    harness.advance();
    const initial = await harness.service.analyzeBoard(created.session.id, {
      scene: RATE_LIMITER_INITIAL_SCENE,
      diff: RATE_LIMITER_INITIAL_DIFF,
      boardImage: null,
      triggerReason: "Candidate completed the initial regional design.",
      urgency: "next_pause",
    });
    expect(initial.analysisVersion).toBe(1);
    expect(initial.reasoningState.contradictions).toHaveLength(1);
    expect(
      [...initial.reasoningState.recommendedProbe.focusElementIds].sort(),
    ).toEqual([RATE_LIMITER_IDS.usRedis, RATE_LIMITER_IDS.euRedis].sort());
    expect(initial.reasoningState.recommendedProbe.question).toMatch(/one shared limit/i);

    harness.advance();
    const revised = await harness.service.analyzeBoard(created.session.id, {
      scene: RATE_LIMITER_REVISED_SCENE,
      diff: RATE_LIMITER_REVISION_DIFF,
      boardImage: null,
      triggerReason: "Candidate added shared coordination.",
      urgency: "next_pause",
    });
    expect(revised.analysisVersion).toBe(2);
    expect(revised.reasoningState.contradictions).toEqual([]);
    expect(
      revised.reasoningState.observations.some(
        (observation) => observation.category === "revision",
      ),
    ).toBe(true);
    expect(revised.reasoningState.recommendedProbe.focusElementIds).toEqual([
      RATE_LIMITER_IDS.coordinator,
    ]);

    harness.advance();
    const finished = await harness.service.finishInterview(created.session.id);
    expect(finished.session.stage).toBe("COMPLETE");
    expect(finished.report.contradictionProbeRevision.detectedInconsistency).not.toBeNull();
    expect(finished.report.contradictionProbeRevision.interviewerProbe).not.toBeNull();
    expect(finished.report.contradictionProbeRevision.candidateRevision).not.toBeNull();

    const reportBundle = await harness.service.getReport(created.session.id);
    expect(reportBundle.report.id).toBe(finished.report.id);
    expect(reportBundle.snapshots).toHaveLength(2);
    expect(
      reportBundle.events.some((event) => event.type === "candidate.revision.detected"),
    ).toBe(true);

    await expect(harness.service.deleteInterview(created.session.id)).resolves.toEqual({
      deleted: true,
      deletedSnapshots: 2,
    });
    await expect(harness.service.getInterview(created.session.id)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      status: 404,
    });
  });

  it("rejects a model focus ID that is not present in the current scene", async () => {
    const harness = testService();
    const originalAnalyze = harness.runtime.gemini.analyzeBoard.bind(harness.runtime.gemini);
    harness.runtime.gemini.analyzeBoard = async (input) => {
      const safe = await originalAnalyze(input);
      return {
        ...safe,
        recommendedProbe: {
          ...safe.recommendedProbe,
          focusElementIds: ["invented-store"],
        },
      };
    };
    const created = await harness.service.createInterview({
      scenarioId: "global-rate-limiter",
      mode: "demo",
      inputMode: "text",
      consent: { transcript: true, microphone: false },
    });
    const transcriptTime = harness.advance();
    await harness.service.appendTranscript(created.session.id, {
      type: "transcript.input.finalized",
      segment: {
        id: RATE_LIMITER_IDS.globalClaimTranscript,
        sessionId: created.session.id,
        speaker: "candidate",
        source: "text",
        text: RATE_LIMITER_GLOBAL_CLAIM,
        startedAt: transcriptTime,
        endedAt: transcriptTime,
        finalized: true,
      },
    });
    await expect(
      harness.service.analyzeBoard(created.session.id, {
        scene: RATE_LIMITER_INITIAL_SCENE,
        diff: RATE_LIMITER_INITIAL_DIFF,
        boardImage: null,
        triggerReason: "Test ungrounded provider output.",
        urgency: "next_pause",
      }),
    ).rejects.toMatchObject({ code: "UNGROUNDED_ANALYSIS", status: 422 });
    expect((await harness.service.getInterview(created.session.id)).snapshots).toEqual([]);
  });
});
