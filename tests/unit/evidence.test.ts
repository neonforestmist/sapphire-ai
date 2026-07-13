import { describe, expect, it } from "vitest";

import {
  EvidenceTimelineError,
  appendSessionEvent,
  reduceSessionEvents,
  validateFinalReportEvidence,
} from "@/lib/interview/evidence";
import { createDeterministicMockReasoning } from "@/lib/interview/mock-reasoning";
import type {
  FinalReport,
  ReportEvidenceItem,
  ReportTimelineItem,
  SessionEvent,
} from "@/lib/interview/schemas";
import {
  RATE_LIMITER_GLOBAL_TRANSCRIPT,
  RATE_LIMITER_IDS,
  RATE_LIMITER_INITIAL_SCENE,
  createRateLimiterAnalysisInput,
} from "@/lib/whiteboard/rate-limiter-fixture";

const initialReasoning = createDeterministicMockReasoning(
  createRateLimiterAnalysisInput(false),
);

const createCoreEvents = (): SessionEvent[] => [
  {
    id: "event-session-created",
    sessionId: RATE_LIMITER_IDS.session,
    sequence: 1,
    occurredAt: 100,
    type: "session.created",
    payload: {
      scenarioId: "global-rate-limiter",
      mode: "demo",
      initialStage: "SETUP",
    },
  },
  {
    id: "event-consent",
    sessionId: RATE_LIMITER_IDS.session,
    sequence: 2,
    occurredAt: 110,
    type: "consent.accepted",
    payload: { transcriptStorageAccepted: true, microphoneAccepted: false },
  },
  {
    id: "event-snapshot",
    sessionId: RATE_LIMITER_IDS.session,
    sequence: 3,
    occurredAt: 1_000,
    type: "board.snapshot.created",
    payload: {
      snapshot: {
        id: RATE_LIMITER_IDS.initialSnapshot,
        sessionId: RATE_LIMITER_IDS.session,
        createdAt: 1_000,
        scene: RATE_LIMITER_INITIAL_SCENE,
        imageObjectPath: null,
        imageMimeType: null,
        analysisVersion: 1,
      },
    },
  },
  {
    id: "event-transcript",
    sessionId: RATE_LIMITER_IDS.session,
    sequence: 4,
    occurredAt: 1_100,
    type: "transcript.input.finalized",
    payload: { segment: RATE_LIMITER_GLOBAL_TRANSCRIPT },
  },
  {
    id: "event-analysis-requested",
    sessionId: RATE_LIMITER_IDS.session,
    sequence: 5,
    occurredAt: 1_200,
    type: "board.analysis.requested",
    payload: {
      analysisVersion: 1,
      snapshotId: RATE_LIMITER_IDS.initialSnapshot,
      reason: "Candidate paused after a significant claim.",
      urgency: "next_pause",
    },
  },
  {
    id: "event-analysis-completed",
    sessionId: RATE_LIMITER_IDS.session,
    sequence: 6,
    occurredAt: 1_300,
    type: "board.analysis.completed",
    payload: {
      analysisVersion: 1,
      snapshotId: RATE_LIMITER_IDS.initialSnapshot,
      reasoningState: initialReasoning,
    },
  },
  {
    id: "event-elements-focused",
    sessionId: RATE_LIMITER_IDS.session,
    sequence: 7,
    occurredAt: 1_400,
    type: "board.elements.focused",
    payload: {
      analysisVersion: 1,
      snapshotId: RATE_LIMITER_IDS.initialSnapshot,
      elementIds: [RATE_LIMITER_IDS.usRedis, RATE_LIMITER_IDS.euRedis],
      message: "Inspect the disconnected regional stores.",
    },
  },
];

describe("append-only evidence timeline", () => {
  it("reduces a grounded contradiction sequence with stable references", () => {
    const state = reduceSessionEvents(createCoreEvents());

    expect(state.lastSequence).toBe(7);
    expect(state.transcriptSegments.has(RATE_LIMITER_IDS.globalClaimTranscript)).toBe(true);
    expect(state.snapshots.has(RATE_LIMITER_IDS.initialSnapshot)).toBe(true);
    expect(state.latestReasoningState?.contradictions).toHaveLength(1);
    expect(state.focusedElementIds).toEqual([
      RATE_LIMITER_IDS.usRedis,
      RATE_LIMITER_IDS.euRedis,
    ]);
  });

  it("requires contiguous sequence, one session, and monotonic timestamps", () => {
    const events = createCoreEvents();
    expect(() => reduceSessionEvents([{ ...events[0]!, sequence: 2 }])).toThrow(
      /first event/i,
    );
    expect(() =>
      reduceSessionEvents([
        events[0]!,
        { ...events[1]!, sessionId: "another-session" },
      ]),
    ).toThrow(/same session|created session/i);
    expect(() =>
      reduceSessionEvents([events[0]!, { ...events[1]!, occurredAt: 99 }]),
    ).toThrow(/monotonic/i);
  });

  it("requires consent before storing a finalized transcript", () => {
    const created = createCoreEvents()[0]!;
    const transcript = { ...createCoreEvents()[3]!, sequence: 2 } as SessionEvent;

    expect(() => reduceSessionEvents([created, transcript])).toThrow(/consent/i);
  });

  it("rejects unknown focus/evidence IDs and stale completions", () => {
    const events = createCoreEvents();
    const unknownFocus = {
      ...events[6]!,
      payload: { ...events[6]!.payload, elementIds: ["invented-element"] },
    } as SessionEvent;
    expect(() => reduceSessionEvents([...events.slice(0, 6), unknownFocus])).toThrow(
      /unknown or deleted/i,
    );

    const secondRequest: SessionEvent = {
      id: "event-analysis-requested-2",
      sessionId: RATE_LIMITER_IDS.session,
      sequence: 6,
      occurredAt: 1_250,
      type: "board.analysis.requested",
      payload: {
        analysisVersion: 2,
        snapshotId: RATE_LIMITER_IDS.initialSnapshot,
        reason: "A newer board analysis supersedes the first.",
        urgency: "next_pause",
      },
    };
    const staleCompletion = { ...events[5]!, sequence: 7, occurredAt: 1_300 } as SessionEvent;
    expect(() =>
      reduceSessionEvents([...events.slice(0, 5), secondRequest, staleCompletion]),
    ).toThrow(/in flight|stale/i);
  });

  it("appends immutably and rejects an invalid append", () => {
    const existing = createCoreEvents().slice(0, 1);
    const next = createCoreEvents()[1]!;
    const appended = appendSessionEvent(existing, next);

    expect(existing).toHaveLength(1);
    expect(appended).toHaveLength(2);
    expect(Object.isFrozen(appended)).toBe(true);
    expect(() => appendSessionEvent(existing, { ...next, sequence: 3 })).toThrow(
      EvidenceTimelineError,
    );
  });
});

const createEvidenceReport = (): FinalReport => {
  const evidence = {
    transcriptSegmentIds: [RATE_LIMITER_IDS.globalClaimTranscript],
    boardElementIds: [RATE_LIMITER_IDS.usRedis, RATE_LIMITER_IDS.euRedis],
    snapshotId: RATE_LIMITER_IDS.initialSnapshot,
  };
  const item = (id: string): ReportEvidenceItem => ({
    id,
    title: "Evidence-grounded judgment",
    explanation: "The global consistency claim conflicts with disconnected regional stores.",
    occurredAt: 1_300,
    evidence,
    confidence: 0.95,
  });
  const timeline = (id: string, kind: ReportTimelineItem["kind"]): ReportTimelineItem => ({
    id,
    eventId: "event-analysis-completed",
    kind,
    label: "Sapphire detected the consistency mismatch.",
    occurredAt: 1_300,
    evidence,
  });
  const section = (id: string) => ({
    summary: "The report uses only stored interview evidence.",
    judgments: [item(`judgment-${id}`)],
  });

  return {
    id: "report-rate-limiter",
    sessionId: RATE_LIMITER_IDS.session,
    generatedAt: 2_000,
    problemFraming: section("problem-framing"),
    requirementDiscovery: section("requirement-discovery"),
    decomposition: section("decomposition"),
    technicalCorrectness: section("technical-correctness"),
    tradeoffReasoning: section("tradeoff-reasoning"),
    adaptabilityUnderChallenge: section("adaptability"),
    communication: section("communication"),
    strongestObservedMoment: item("strongest-moment"),
    mostImportantMissedIssue: item("missed-issue"),
    keyDecisionTimeline: [timeline("decision-timeline", "decision")],
    boardEvolutionTimeline: [timeline("board-timeline", "board_change")],
    contradictionProbeRevision: {
      initialDecision: timeline("sequence-initial", "decision"),
      detectedInconsistency: timeline("sequence-contradiction", "contradiction"),
      interviewerProbe: timeline("sequence-probe", "probe"),
      candidateRevision: null,
    },
    practiceExercises: [
      {
        id: "exercise-consistency",
        title: "Consistency semantics",
        instruction: "Compare strong and eventual global quota enforcement.",
        rationale: "Make the availability and latency trade-off explicit.",
      },
      {
        id: "exercise-failures",
        title: "Regional failure",
        instruction: "Walk through a cross-region network partition.",
        rationale: "Connect the mechanism to failure behavior.",
      },
      {
        id: "exercise-hot-keys",
        title: "Hot keys",
        instruction: "Design safeguards for one extremely active user.",
        rationale: "Test operational depth beyond the happy path.",
      },
    ],
    limitations: ["This report evaluates only observable transcript and board artifacts."],
    confidence: 0.93,
  };
};

describe("final report evidence validation", () => {
  it("resolves every judgment and replay reference to the event timeline", () => {
    const state = reduceSessionEvents(createCoreEvents());
    const report = createEvidenceReport();

    expect(validateFinalReportEvidence(report, state)).toEqual(report);
  });

  it("rejects a timeline link to an event that does not exist", () => {
    const state = reduceSessionEvents(createCoreEvents());
    const report = createEvidenceReport();
    report.keyDecisionTimeline[0] = {
      ...report.keyDecisionTimeline[0]!,
      eventId: "invented-event",
    };

    expect(() => validateFinalReportEvidence(report, state)).toThrow(/unknown event/i);
  });
});
