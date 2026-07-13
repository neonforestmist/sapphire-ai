import { z } from "zod";

import {
  boardDiffSchema,
  normalizedBoardSceneSchema,
  stableBoardElementIdSchema,
} from "../whiteboard/schemas";

const hasUniqueValues = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

export const domainIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "IDs may only contain letters, numbers, '_' and '-'");

const nonEmptyTextSchema = z.string().trim().min(1).max(8_000);
const shortTextSchema = z.string().trim().min(1).max(1_000);
const timestampSchema = z.number().int().nonnegative();
const confidenceSchema = z.number().finite().min(0).max(1);

const uniqueDomainIdsSchema = z
  .array(domainIdSchema)
  .max(512)
  .refine(hasUniqueValues, "ID lists must not contain duplicates");

const uniqueBoardElementIdsSchema = z
  .array(stableBoardElementIdSchema)
  .max(512)
  .refine(hasUniqueValues, "Element ID lists must not contain duplicates");

export const interviewStageSchema = z.enum([
  "SETUP",
  "BRIEFING",
  "REQUIREMENT_CLARIFICATION",
  "INITIAL_DECOMPOSITION",
  "SOLUTION_CONSTRUCTION",
  "CONSTRAINT_INJECTION",
  "TRADEOFF_CHALLENGE",
  "REFLECTION",
  "GENERATING_REPORT",
  "COMPLETE",
]);

export type InterviewStage = z.infer<typeof interviewStageSchema>;

export const transcriptSegmentSchema = z
  .object({
    id: domainIdSchema,
    sessionId: domainIdSchema,
    speaker: z.enum(["candidate", "interviewer"]),
    source: z.enum(["text", "live_input", "live_output", "mock"]),
    text: nonEmptyTextSchema,
    startedAt: timestampSchema,
    endedAt: timestampSchema,
    finalized: z.literal(true),
  })
  .strict()
  .refine((segment) => segment.endedAt >= segment.startedAt, {
    message: "endedAt must be greater than or equal to startedAt",
    path: ["endedAt"],
  });

export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const evidenceRefSchema = z
  .object({
    transcriptSegmentIds: uniqueDomainIdsSchema,
    boardElementIds: uniqueBoardElementIdsSchema,
    snapshotId: domainIdSchema.nullable(),
  })
  .strict();

export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const competencyNameSchema = z.enum([
  "problem_framing",
  "requirement_discovery",
  "decomposition",
  "technical_correctness",
  "tradeoff_reasoning",
  "adaptability",
  "communication",
]);

export const competencySignalSchema = z
  .object({
    id: domainIdSchema,
    competency: competencyNameSchema,
    sentiment: z.enum(["strength", "growth_area", "neutral"]),
    statement: shortTextSchema,
    evidence: evidenceRefSchema,
    confidence: confidenceSchema,
  })
  .strict();

export type CompetencySignal = z.infer<typeof competencySignalSchema>;

export const reasoningObservationSchema = z
  .object({
    id: domainIdSchema,
    category: z.enum([
      "decision",
      "assumption",
      "requirement",
      "tradeoff",
      "revision",
      "positive_signal",
      "missing_constraint",
    ]),
    statement: shortTextSchema,
    evidence: evidenceRefSchema,
    confidence: confidenceSchema,
  })
  .strict();

export type ReasoningObservation = z.infer<typeof reasoningObservationSchema>;

export const contradictionSchema = z
  .object({
    id: domainIdSchema,
    description: shortTextSchema,
    spokenClaim: z.string().trim().min(1).max(1_000).nullable(),
    boardInterpretation: shortTextSchema,
    whyItMatters: shortTextSchema,
    evidence: evidenceRefSchema,
    confidence: confidenceSchema,
  })
  .strict()
  .superRefine((contradiction, context) => {
    if (
      contradiction.evidence.boardElementIds.length === 0 ||
      contradiction.evidence.snapshotId === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A board contradiction requires element IDs and a snapshot",
        path: ["evidence"],
      });
    }
  });

export type Contradiction = z.infer<typeof contradictionSchema>;

export const recommendedProbeSchema = z
  .object({
    action: z.enum(["wait", "ask", "inject_constraint", "advance_stage"]),
    question: z.string().trim().min(1).max(1_000).nullable(),
    reason: shortTextSchema,
    focusElementIds: uniqueBoardElementIdsSchema,
    urgency: z.enum(["wait", "next_pause", "interrupt"]),
    confidence: confidenceSchema,
  })
  .strict()
  .superRefine((probe, context) => {
    if (probe.action === "ask" && probe.question === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An ask probe must include a question",
        path: ["question"],
      });
    }
    if (probe.action === "wait" && probe.urgency !== "wait") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A wait probe must use wait urgency",
        path: ["urgency"],
      });
    }
  });

export type RecommendedProbe = z.infer<typeof recommendedProbeSchema>;

export const reasoningStateSchema = z
  .object({
    boardSummary: z.string().trim().max(4_000),
    candidateApproachSummary: z.string().trim().max(4_000),
    observations: z.array(reasoningObservationSchema).max(100),
    contradictions: z.array(contradictionSchema).max(25),
    unresolvedQuestions: z.array(shortTextSchema).max(50),
    updatedCompetencySignals: z.array(competencySignalSchema).max(100),
    recommendedProbe: recommendedProbeSchema,
    analysisConfidence: confidenceSchema,
  })
  .strict();

export type ReasoningState = z.infer<typeof reasoningStateSchema>;

export const blueprintInputSchema = z
  .object({
    scenarioId: domainIdSchema,
    mode: z.enum(["demo", "normal"]),
  })
  .strict();

export type BlueprintInput = z.infer<typeof blueprintInputSchema>;

export const interviewConstraintSchema = z
  .object({
    id: domainIdSchema,
    text: shortTextSchema,
    targetStage: interviewStageSchema,
  })
  .strict();

export const interviewBlueprintSchema = z
  .object({
    id: domainIdSchema,
    scenarioId: domainIdSchema,
    roleTitle: shortTextSchema,
    seniority: shortTextSchema,
    problemStatement: nonEmptyTextSchema,
    initialKnownRequirements: z.array(shortTextSchema).min(1).max(20),
    withheldClarifications: z
      .array(
        z
          .object({
            id: domainIdSchema,
            questionPattern: shortTextSchema,
            answer: shortTextSchema,
          })
          .strict(),
      )
      .max(20),
    hiddenRubric: z.array(shortTextSchema).min(1).max(30),
    constraints: z.array(interviewConstraintSchema).max(10),
    competencyDefinitions: z
      .array(
        z
          .object({
            competency: competencyNameSchema,
            description: shortTextSchema,
          })
          .strict(),
      )
      .min(1)
      .max(20),
    stageGuidance: z
      .array(
        z
          .object({
            stage: interviewStageSchema,
            guidance: shortTextSchema,
          })
          .strict(),
      )
      .min(1)
      .max(10),
    reportTemplateSections: z.array(shortTextSchema).min(1).max(30),
    estimatedDurationMinutes: z.number().int().min(1).max(120),
  })
  .strict();

export type InterviewBlueprint = z.infer<typeof interviewBlueprintSchema>;

export const interviewSessionSchema = z
  .object({
    id: domainIdSchema,
    scenarioId: domainIdSchema,
    mode: z.enum(["demo", "normal"]),
    stage: interviewStageSchema,
    status: z.enum(["active", "generating_report", "complete"]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    latestAnalysisVersion: z.number().int().nonnegative(),
  })
  .strict()
  .refine((session) => session.updatedAt >= session.createdAt, {
    message: "updatedAt must be greater than or equal to createdAt",
    path: ["updatedAt"],
  });

export type InterviewSession = z.infer<typeof interviewSessionSchema>;

export const boardSnapshotRecordSchema = z
  .object({
    id: domainIdSchema,
    sessionId: domainIdSchema,
    createdAt: timestampSchema,
    scene: normalizedBoardSceneSchema,
    imageObjectPath: z.string().trim().min(1).max(1_024).nullable(),
    imageMimeType: z.enum(["image/png", "image/jpeg", "image/webp"]).nullable(),
    analysisVersion: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if ((snapshot.imageObjectPath === null) !== (snapshot.imageMimeType === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "imageObjectPath and imageMimeType must either both be present or both be null",
        path: ["imageObjectPath"],
      });
    }
  });

export type BoardSnapshotRecord = z.infer<typeof boardSnapshotRecordSchema>;

export const boardImageInputSchema = z
  .object({
    dataBase64: z.string().min(4).max(16_000_000),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    width: z.number().int().positive().max(1_600),
    height: z.number().int().positive().max(1_600),
  })
  .strict();

export const boardAnalysisInputSchema = z
  .object({
    requestId: domainIdSchema,
    sessionId: domainIdSchema,
    analysisVersion: z.number().int().positive(),
    snapshotId: domainIdSchema.nullable(),
    problemStatement: nonEmptyTextSchema,
    boardImage: boardImageInputSchema.nullable(),
    scene: normalizedBoardSceneSchema,
    diff: boardDiffSchema,
    previousReasoningState: reasoningStateSchema.nullable(),
    currentStage: interviewStageSchema,
    recentTranscript: z.array(transcriptSegmentSchema).max(100),
    olderSessionSummary: z.string().trim().max(8_000),
    hiddenRubric: z.array(shortTextSchema).min(1).max(30),
    activeConstraints: z
      .array(
        z
          .object({
            id: domainIdSchema,
            text: shortTextSchema,
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .superRefine((input, context) => {
    for (const [index, segment] of input.recentTranscript.entries()) {
      if (segment.sessionId !== input.sessionId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Transcript segment belongs to a different session",
          path: ["recentTranscript", index, "sessionId"],
        });
      }
    }
  });

export type BoardAnalysisInput = z.infer<typeof boardAnalysisInputSchema>;

export const liveTokenInputSchema = z
  .object({
    sessionId: domainIdSchema,
    systemInstruction: nonEmptyTextSchema,
  })
  .strict();

export type LiveTokenInput = z.infer<typeof liveTokenInputSchema>;

export const liveTokenResultSchema = z
  .object({
    token: z.string().min(1).max(16_000),
    expiresAt: timestampSchema,
    newSessionExpiresAt: timestampSchema,
    model: z.string().trim().min(1).max(256),
  })
  .strict()
  .refine((result) => result.newSessionExpiresAt <= result.expiresAt, {
    message: "newSessionExpiresAt must not be later than expiresAt",
    path: ["newSessionExpiresAt"],
  });

export type LiveTokenResult = z.infer<typeof liveTokenResultSchema>;

const sessionEventEnvelopeSchema = z.object({
  id: domainIdSchema,
  sessionId: domainIdSchema,
  sequence: z.number().int().positive(),
  occurredAt: timestampSchema,
});

export const sessionCreatedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("session.created"),
    payload: z
      .object({
        scenarioId: domainIdSchema,
        mode: z.enum(["demo", "normal"]),
        initialStage: z.literal("SETUP"),
      })
      .strict(),
  })
  .strict();

export const consentAcceptedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("consent.accepted"),
    payload: z
      .object({
        transcriptStorageAccepted: z.literal(true),
        microphoneAccepted: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const stageChangedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("stage.changed"),
    payload: z
      .object({
        from: interviewStageSchema,
        to: interviewStageSchema,
        reason: shortTextSchema,
        recommendedBy: z.enum(["application", "gemini", "candidate"]),
      })
      .strict(),
  })
  .strict();

const transcriptEventPayloadSchema = z.object({
  segment: transcriptSegmentSchema,
});

export const transcriptInputFinalizedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("transcript.input.finalized"),
    payload: transcriptEventPayloadSchema.strict(),
  })
  .strict();

export const transcriptOutputFinalizedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("transcript.output.finalized"),
    payload: transcriptEventPayloadSchema.strict(),
  })
  .strict();

export const boardSnapshotCreatedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("board.snapshot.created"),
    payload: z.object({ snapshot: boardSnapshotRecordSchema }).strict(),
  })
  .strict();

export const boardSemanticDiffCreatedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("board.semantic_diff.created"),
    payload: z
      .object({
        snapshotId: domainIdSchema,
        previousSnapshotId: domainIdSchema.nullable(),
        diff: boardDiffSchema,
      })
      .strict(),
  })
  .strict();

export const boardAnalysisRequestedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("board.analysis.requested"),
    payload: z
      .object({
        analysisVersion: z.number().int().positive(),
        snapshotId: domainIdSchema,
        reason: shortTextSchema,
        urgency: z.enum(["wait", "next_pause", "interrupt"]),
      })
      .strict(),
  })
  .strict();

export const boardAnalysisCompletedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("board.analysis.completed"),
    payload: z
      .object({
        analysisVersion: z.number().int().positive(),
        snapshotId: domainIdSchema,
        reasoningState: reasoningStateSchema,
      })
      .strict(),
  })
  .strict();

export const boardElementsFocusedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("board.elements.focused"),
    payload: z
      .object({
        analysisVersion: z.number().int().positive(),
        snapshotId: domainIdSchema,
        elementIds: uniqueBoardElementIdsSchema.refine(
          (elementIds) => elementIds.length > 0,
          "A focus event requires at least one element ID",
        ),
        message: shortTextSchema,
      })
      .strict(),
  })
  .strict();

export const constraintInjectedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("constraint.injected"),
    payload: z.object({ constraintId: domainIdSchema, text: shortTextSchema }).strict(),
  })
  .strict();

export const candidateRevisionDetectedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("candidate.revision.detected"),
    payload: z
      .object({
        observationId: domainIdSchema,
        evidence: evidenceRefSchema,
      })
      .strict(),
  })
  .strict();

export const interviewCompletedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("interview.completed"),
    payload: z.object({ reason: shortTextSchema }).strict(),
  })
  .strict();

export const reportGeneratedEventSchema = sessionEventEnvelopeSchema
  .extend({
    type: z.literal("report.generated"),
    payload: z.object({ reportId: domainIdSchema }).strict(),
  })
  .strict();

export const sessionEventSchema = z.discriminatedUnion("type", [
  sessionCreatedEventSchema,
  consentAcceptedEventSchema,
  stageChangedEventSchema,
  transcriptInputFinalizedEventSchema,
  transcriptOutputFinalizedEventSchema,
  boardSnapshotCreatedEventSchema,
  boardSemanticDiffCreatedEventSchema,
  boardAnalysisRequestedEventSchema,
  boardAnalysisCompletedEventSchema,
  boardElementsFocusedEventSchema,
  constraintInjectedEventSchema,
  candidateRevisionDetectedEventSchema,
  interviewCompletedEventSchema,
  reportGeneratedEventSchema,
]);

export type SessionEvent = z.infer<typeof sessionEventSchema>;

export const reportEvidenceItemSchema = z
  .object({
    id: domainIdSchema,
    title: shortTextSchema,
    explanation: nonEmptyTextSchema,
    occurredAt: timestampSchema,
    evidence: evidenceRefSchema,
    confidence: confidenceSchema,
  })
  .strict();

export type ReportEvidenceItem = z.infer<typeof reportEvidenceItemSchema>;

export const reportSectionSchema = z
  .object({
    summary: nonEmptyTextSchema,
    judgments: z.array(reportEvidenceItemSchema).min(1).max(20),
  })
  .strict();

export const reportTimelineItemSchema = z
  .object({
    id: domainIdSchema,
    eventId: domainIdSchema,
    kind: z.enum([
      "decision",
      "board_change",
      "contradiction",
      "probe",
      "revision",
      "constraint",
      "reflection",
    ]),
    label: shortTextSchema,
    occurredAt: timestampSchema,
    evidence: evidenceRefSchema,
  })
  .strict();

export type ReportTimelineItem = z.infer<typeof reportTimelineItemSchema>;

export const finalReportSchema = z
  .object({
    id: domainIdSchema,
    sessionId: domainIdSchema,
    generatedAt: timestampSchema,
    problemFraming: reportSectionSchema,
    requirementDiscovery: reportSectionSchema,
    decomposition: reportSectionSchema,
    technicalCorrectness: reportSectionSchema,
    tradeoffReasoning: reportSectionSchema,
    adaptabilityUnderChallenge: reportSectionSchema,
    communication: reportSectionSchema,
    strongestObservedMoment: reportEvidenceItemSchema,
    mostImportantMissedIssue: reportEvidenceItemSchema,
    keyDecisionTimeline: z.array(reportTimelineItemSchema).min(1).max(100),
    boardEvolutionTimeline: z.array(reportTimelineItemSchema).min(1).max(100),
    contradictionProbeRevision: z
      .object({
        initialDecision: reportTimelineItemSchema.nullable(),
        detectedInconsistency: reportTimelineItemSchema.nullable(),
        interviewerProbe: reportTimelineItemSchema.nullable(),
        candidateRevision: reportTimelineItemSchema.nullable(),
      })
      .strict(),
    practiceExercises: z
      .array(
        z
          .object({
            id: domainIdSchema,
            title: shortTextSchema,
            instruction: nonEmptyTextSchema,
            rationale: nonEmptyTextSchema,
          })
          .strict(),
      )
      .length(3),
    limitations: z.array(shortTextSchema).min(1).max(20),
    confidence: confidenceSchema,
  })
  .strict();

export type FinalReport = z.infer<typeof finalReportSchema>;

export const finalReportInputSchema = z
  .object({
    session: interviewSessionSchema,
    blueprint: interviewBlueprintSchema,
    events: z.array(sessionEventSchema).min(1).max(10_000),
    snapshots: z.array(boardSnapshotRecordSchema).max(500),
    finalReasoningState: reasoningStateSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    for (const [index, event] of input.events.entries()) {
      if (event.sessionId !== input.session.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Event belongs to a different session",
          path: ["events", index, "sessionId"],
        });
      }
    }
    for (const [index, snapshot] of input.snapshots.entries()) {
      if (snapshot.sessionId !== input.session.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Snapshot belongs to a different session",
          path: ["snapshots", index, "sessionId"],
        });
      }
    }
  });

export type FinalReportInput = z.infer<typeof finalReportInputSchema>;
