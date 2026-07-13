import {
  finalReportSchema,
  sessionCreatedEventSchema,
  sessionEventSchema,
  type BoardSnapshotRecord,
  type EvidenceRef,
  type FinalReport,
  type InterviewStage,
  type ReasoningState,
  type ReportEvidenceItem,
  type ReportTimelineItem,
  type SessionEvent,
  type TranscriptSegment,
} from "./schemas";
import { assertLegalInterviewStageTransition } from "./state-machine";

export type EvidenceTimelineErrorCode =
  | "EMPTY_TIMELINE"
  | "INVALID_FIRST_EVENT"
  | "DUPLICATE_EVENT_ID"
  | "WRONG_SESSION"
  | "NON_CONTIGUOUS_SEQUENCE"
  | "NON_MONOTONIC_TIME"
  | "DUPLICATE_ENTITY"
  | "MISSING_CONSENT"
  | "INVALID_STAGE_TRANSITION"
  | "UNKNOWN_REFERENCE"
  | "INVALID_EVENT_ORDER"
  | "STALE_ANALYSIS";

export class EvidenceTimelineError extends Error {
  public readonly code: EvidenceTimelineErrorCode;
  public readonly eventId: string | null;

  public constructor(
    code: EvidenceTimelineErrorCode,
    message: string,
    eventId: string | null = null,
  ) {
    super(message);
    this.name = "EvidenceTimelineError";
    this.code = code;
    this.eventId = eventId;
  }
}

export type AnalysisRequestEvidence = Readonly<{
  snapshotId: string;
  completed: boolean;
}>;

export type EvidenceTimelineState = Readonly<{
  sessionId: string;
  events: readonly SessionEvent[];
  eventIds: ReadonlySet<string>;
  lastSequence: number;
  lastOccurredAt: number;
  stage: InterviewStage;
  consentAccepted: boolean;
  transcriptSegments: ReadonlyMap<string, TranscriptSegment>;
  snapshots: ReadonlyMap<string, BoardSnapshotRecord>;
  analysisRequests: ReadonlyMap<number, AnalysisRequestEvidence>;
  latestAnalysisVersion: number;
  latestReasoningState: ReasoningState | null;
  focusedElementIds: readonly string[];
  injectedConstraintIds: ReadonlySet<string>;
  completed: boolean;
  reportId: string | null;
}>;

const fail = (
  code: EvidenceTimelineErrorCode,
  message: string,
  eventId: string | null = null,
): never => {
  throw new EvidenceTimelineError(code, message, eventId);
};

const activeElementIds = (snapshot: BoardSnapshotRecord): Set<string> =>
  new Set(snapshot.scene.elements.filter((element) => !element.deleted).map((element) => element.id));

const validateEvidenceReference = (
  evidence: EvidenceRef,
  transcripts: ReadonlyMap<string, TranscriptSegment>,
  snapshots: ReadonlyMap<string, BoardSnapshotRecord>,
  fallbackSnapshotId: string | null,
  eventId: string,
): void => {
  for (const transcriptId of evidence.transcriptSegmentIds) {
    if (!transcripts.has(transcriptId)) {
      fail(
        "UNKNOWN_REFERENCE",
        `Evidence references unknown transcript segment '${transcriptId}'`,
        eventId,
      );
    }
  }

  const snapshotId = evidence.snapshotId ?? fallbackSnapshotId;
  if (evidence.boardElementIds.length === 0) {
    if (evidence.snapshotId !== null && !snapshots.has(evidence.snapshotId)) {
      fail(
        "UNKNOWN_REFERENCE",
        `Evidence references unknown snapshot '${evidence.snapshotId}'`,
        eventId,
      );
    }
    return;
  }
  if (snapshotId === null) {
    fail("UNKNOWN_REFERENCE", "Board evidence requires a snapshot reference", eventId);
  }

  const resolvedSnapshotId = snapshotId as string;
  const snapshot =
    snapshots.get(resolvedSnapshotId) ??
    fail(
      "UNKNOWN_REFERENCE",
      `Evidence references unknown snapshot '${resolvedSnapshotId}'`,
      eventId,
    );
  const knownElementIds = activeElementIds(snapshot);
  for (const elementId of evidence.boardElementIds) {
    if (!knownElementIds.has(elementId)) {
      fail(
        "UNKNOWN_REFERENCE",
        `Evidence references unknown or deleted board element '${elementId}'`,
        eventId,
      );
    }
  }
};

const validateReasoningEvidence = (
  reasoning: ReasoningState,
  transcripts: ReadonlyMap<string, TranscriptSegment>,
  snapshots: ReadonlyMap<string, BoardSnapshotRecord>,
  snapshotId: string,
  eventId: string,
): void => {
  for (const observation of reasoning.observations) {
    validateEvidenceReference(observation.evidence, transcripts, snapshots, snapshotId, eventId);
  }
  for (const contradiction of reasoning.contradictions) {
    validateEvidenceReference(contradiction.evidence, transcripts, snapshots, snapshotId, eventId);
  }
  for (const signal of reasoning.updatedCompetencySignals) {
    validateEvidenceReference(signal.evidence, transcripts, snapshots, snapshotId, eventId);
  }

  const snapshot =
    snapshots.get(snapshotId) ??
    fail("UNKNOWN_REFERENCE", `Analysis references unknown snapshot '${snapshotId}'`, eventId);
  const knownElementIds = activeElementIds(snapshot);
  for (const focusId of reasoning.recommendedProbe.focusElementIds) {
    if (!knownElementIds.has(focusId)) {
      fail(
        "UNKNOWN_REFERENCE",
        `Recommended probe references unknown or deleted element '${focusId}'`,
        eventId,
      );
    }
  }
};

export const reduceSessionEvents = (input: readonly SessionEvent[]): EvidenceTimelineState => {
  if (input.length === 0) {
    fail("EMPTY_TIMELINE", "A session timeline must contain at least session.created");
  }

  const events = input.map((event) => sessionEventSchema.parse(event));
  const first = events[0]!;
  if (first.type !== "session.created") {
    fail(
      "INVALID_FIRST_EVENT",
      "The first event must be session.created with sequence 1",
      first.id,
    );
  }
  if (first.sequence !== 1) {
    fail(
      "INVALID_FIRST_EVENT",
      "The first event must be session.created with sequence 1",
      first.id,
    );
  }
  const createdEvent = sessionCreatedEventSchema.parse(first);

  const sessionId = createdEvent.sessionId;
  const eventIds = new Set<string>();
  const transcriptSegments = new Map<string, TranscriptSegment>();
  const snapshots = new Map<string, BoardSnapshotRecord>();
  const analysisRequests = new Map<number, AnalysisRequestEvidence>();
  const injectedConstraintIds = new Set<string>();
  let stage: InterviewStage = createdEvent.payload.initialStage;
  let consentAccepted = false;
  let lastSequence = 0;
  let lastOccurredAt = 0;
  let latestAnalysisVersion = 0;
  let latestReasoningState: ReasoningState | null = null;
  let focusedElementIds: readonly string[] = [];
  let completed = false;
  let reportId: string | null = null;

  for (const event of events) {
    if (eventIds.has(event.id)) {
      fail("DUPLICATE_EVENT_ID", `Duplicate event ID '${event.id}'`, event.id);
    }
    if (event.sessionId !== sessionId) {
      fail("WRONG_SESSION", "All events must belong to the created session", event.id);
    }
    if (event.sequence !== lastSequence + 1) {
      fail(
        "NON_CONTIGUOUS_SEQUENCE",
        `Expected sequence ${lastSequence + 1}, received ${event.sequence}`,
        event.id,
      );
    }
    if (lastSequence > 0 && event.occurredAt < lastOccurredAt) {
      fail("NON_MONOTONIC_TIME", "Event timestamps must be monotonic", event.id);
    }

    eventIds.add(event.id);
    lastSequence = event.sequence;
    lastOccurredAt = event.occurredAt;

    switch (event.type) {
      case "session.created":
        if (event.sequence !== 1) {
          fail("INVALID_EVENT_ORDER", "session.created may only occur once", event.id);
        }
        break;

      case "consent.accepted":
        if (consentAccepted) {
          fail("DUPLICATE_ENTITY", "Consent has already been accepted", event.id);
        }
        consentAccepted = true;
        break;

      case "stage.changed":
        if (event.payload.from !== stage) {
          fail(
            "INVALID_STAGE_TRANSITION",
            `Stage event expected from '${stage}', received '${event.payload.from}'`,
            event.id,
          );
        }
        try {
          assertLegalInterviewStageTransition(event.payload.from, event.payload.to);
        } catch {
          fail(
            "INVALID_STAGE_TRANSITION",
            `Illegal stage transition '${event.payload.from}' -> '${event.payload.to}'`,
            event.id,
          );
        }
        stage = event.payload.to;
        break;

      case "transcript.input.finalized":
      case "transcript.output.finalized": {
        if (!consentAccepted) {
          fail("MISSING_CONSENT", "Finalized transcripts require prior consent", event.id);
        }
        const segment = event.payload.segment;
        if (segment.sessionId !== sessionId) {
          fail("WRONG_SESSION", "Transcript segment belongs to another session", event.id);
        }
        const expectedSpeaker =
          event.type === "transcript.input.finalized" ? "candidate" : "interviewer";
        if (segment.speaker !== expectedSpeaker) {
          fail(
            "INVALID_EVENT_ORDER",
            `${event.type} requires speaker '${expectedSpeaker}'`,
            event.id,
          );
        }
        if (segment.endedAt > event.occurredAt) {
          fail("NON_MONOTONIC_TIME", "Transcript ends after its event timestamp", event.id);
        }
        if (transcriptSegments.has(segment.id)) {
          fail("DUPLICATE_ENTITY", `Duplicate transcript segment '${segment.id}'`, event.id);
        }
        transcriptSegments.set(segment.id, segment);
        break;
      }

      case "board.snapshot.created": {
        const snapshot = event.payload.snapshot;
        if (snapshot.sessionId !== sessionId) {
          fail("WRONG_SESSION", "Board snapshot belongs to another session", event.id);
        }
        if (snapshot.createdAt > event.occurredAt) {
          fail("NON_MONOTONIC_TIME", "Snapshot is newer than its event timestamp", event.id);
        }
        if (snapshots.has(snapshot.id)) {
          fail("DUPLICATE_ENTITY", `Duplicate snapshot '${snapshot.id}'`, event.id);
        }
        snapshots.set(snapshot.id, snapshot);
        break;
      }

      case "board.semantic_diff.created":
        if (!snapshots.has(event.payload.snapshotId)) {
          fail(
            "UNKNOWN_REFERENCE",
            `Diff references unknown snapshot '${event.payload.snapshotId}'`,
            event.id,
          );
        }
        if (
          event.payload.previousSnapshotId !== null &&
          !snapshots.has(event.payload.previousSnapshotId)
        ) {
          fail(
            "UNKNOWN_REFERENCE",
            `Diff references unknown previous snapshot '${event.payload.previousSnapshotId}'`,
            event.id,
          );
        }
        break;

      case "board.analysis.requested":
        if (!snapshots.has(event.payload.snapshotId)) {
          fail(
            "UNKNOWN_REFERENCE",
            `Analysis references unknown snapshot '${event.payload.snapshotId}'`,
            event.id,
          );
        }
        if (event.payload.analysisVersion !== latestAnalysisVersion + 1) {
          fail(
            "STALE_ANALYSIS",
            `Expected analysis version ${latestAnalysisVersion + 1}`,
            event.id,
          );
        }
        if (
          latestAnalysisVersion > 0 &&
          analysisRequests.get(latestAnalysisVersion)?.completed === false
        ) {
          fail(
            "INVALID_EVENT_ORDER",
            "Only one board analysis may be in flight for a session",
            event.id,
          );
        }
        analysisRequests.set(event.payload.analysisVersion, {
          snapshotId: event.payload.snapshotId,
          completed: false,
        });
        latestAnalysisVersion = event.payload.analysisVersion;
        break;

      case "board.analysis.completed": {
        const request =
          analysisRequests.get(event.payload.analysisVersion) ??
          fail("UNKNOWN_REFERENCE", "Analysis completion has no matching request", event.id);
        if (request.snapshotId !== event.payload.snapshotId) {
          fail("UNKNOWN_REFERENCE", "Analysis completion has no matching request", event.id);
        }
        if (event.payload.analysisVersion !== latestAnalysisVersion || request.completed) {
          fail("STALE_ANALYSIS", "Stale or duplicate analysis completion", event.id);
        }
        validateReasoningEvidence(
          event.payload.reasoningState,
          transcriptSegments,
          snapshots,
          event.payload.snapshotId,
          event.id,
        );
        analysisRequests.set(event.payload.analysisVersion, { ...request, completed: true });
        latestReasoningState = event.payload.reasoningState;
        break;
      }

      case "board.elements.focused": {
        const request = analysisRequests.get(event.payload.analysisVersion);
        if (
          request === undefined ||
          !request.completed ||
          request.snapshotId !== event.payload.snapshotId
        ) {
          fail("INVALID_EVENT_ORDER", "Focus requires a completed matching analysis", event.id);
        }
        const snapshot =
          snapshots.get(event.payload.snapshotId) ??
          fail("UNKNOWN_REFERENCE", "Focus references an unknown snapshot", event.id);
        const knownIds = activeElementIds(snapshot);
        for (const elementId of event.payload.elementIds) {
          if (!knownIds.has(elementId)) {
            fail(
              "UNKNOWN_REFERENCE",
              `Focus references unknown or deleted element '${elementId}'`,
              event.id,
            );
          }
        }
        focusedElementIds = event.payload.elementIds;
        break;
      }

      case "constraint.injected":
        if (injectedConstraintIds.has(event.payload.constraintId)) {
          fail(
            "DUPLICATE_ENTITY",
            `Constraint '${event.payload.constraintId}' was already injected`,
            event.id,
          );
        }
        injectedConstraintIds.add(event.payload.constraintId);
        break;

      case "candidate.revision.detected": {
        validateEvidenceReference(
          event.payload.evidence,
          transcriptSegments,
          snapshots,
          null,
          event.id,
        );
        const revision = latestReasoningState?.observations.find(
          (observation) =>
            observation.id === event.payload.observationId && observation.category === "revision",
        );
        if (revision === undefined) {
          fail(
            "UNKNOWN_REFERENCE",
            `Revision references unknown revision observation '${event.payload.observationId}'`,
            event.id,
          );
        }
        break;
      }

      case "interview.completed":
        if (completed) {
          fail("DUPLICATE_ENTITY", "Interview was already completed", event.id);
        }
        completed = true;
        focusedElementIds = [];
        break;

      case "report.generated":
        if (!completed) {
          fail("INVALID_EVENT_ORDER", "A report requires a completed interview", event.id);
        }
        if (reportId !== null) {
          fail("DUPLICATE_ENTITY", "A report was already generated", event.id);
        }
        reportId = event.payload.reportId;
        break;
    }
  }

  return {
    sessionId,
    events: Object.freeze([...events]),
    eventIds,
    lastSequence,
    lastOccurredAt,
    stage,
    consentAccepted,
    transcriptSegments,
    snapshots,
    analysisRequests,
    latestAnalysisVersion,
    latestReasoningState,
    focusedElementIds,
    injectedConstraintIds,
    completed,
    reportId,
  };
};

/** Return a new validated timeline; the caller's existing array is never mutated. */
export const appendSessionEvent = (
  existing: readonly SessionEvent[],
  next: SessionEvent,
): readonly SessionEvent[] => {
  const candidate = [...existing, sessionEventSchema.parse(next)];
  reduceSessionEvents(candidate);
  return Object.freeze(candidate);
};

const validateReportItem = (
  item: ReportEvidenceItem,
  state: EvidenceTimelineState,
): void =>
  validateEvidenceReference(
    item.evidence,
    state.transcriptSegments,
    state.snapshots,
    null,
    `report-item:${item.id}`,
  );

const validateTimelineItem = (
  item: ReportTimelineItem,
  state: EvidenceTimelineState,
): void => {
  if (!state.eventIds.has(item.eventId)) {
    fail(
      "UNKNOWN_REFERENCE",
      `Report timeline item '${item.id}' references unknown event '${item.eventId}'`,
    );
  }
  validateEvidenceReference(
    item.evidence,
    state.transcriptSegments,
    state.snapshots,
    null,
    `report-timeline:${item.id}`,
  );
};

/** Validate that every report judgment and replay item resolves to stored evidence. */
export const validateFinalReportEvidence = (
  reportInput: FinalReport,
  state: EvidenceTimelineState,
): FinalReport => {
  const report = finalReportSchema.parse(reportInput);
  if (report.sessionId !== state.sessionId) {
    fail("WRONG_SESSION", "Report belongs to another session");
  }

  for (const section of [
    report.problemFraming,
    report.requirementDiscovery,
    report.decomposition,
    report.technicalCorrectness,
    report.tradeoffReasoning,
    report.adaptabilityUnderChallenge,
    report.communication,
  ]) {
    section.judgments.forEach((item) => validateReportItem(item, state));
  }
  validateReportItem(report.strongestObservedMoment, state);
  validateReportItem(report.mostImportantMissedIssue, state);
  report.keyDecisionTimeline.forEach((item) => validateTimelineItem(item, state));
  report.boardEvolutionTimeline.forEach((item) => validateTimelineItem(item, state));
  for (const item of Object.values(report.contradictionProbeRevision)) {
    if (item !== null) {
      validateTimelineItem(item, state);
    }
  }

  return report;
};
