import { randomUUID } from "node:crypto";

import {
  boardAnalysisInputSchema,
  boardSnapshotRecordSchema,
  finalReportSchema,
  interviewSessionSchema,
  liveTokenResultSchema,
  reasoningStateSchema,
  sessionEventSchema,
  transcriptSegmentSchema,
  type BoardAnalysisInput,
  type BoardSnapshotRecord,
  type InterviewBlueprint,
  type InterviewSession,
  type ReasoningState,
  type SessionEvent,
} from "@/lib/interview/schemas";
import {
  appendSessionEvent,
  reduceSessionEvents,
  validateFinalReportEvidence,
} from "@/lib/interview/evidence";
import {
  enforceReasoningConfidenceThreshold,
  sanitizeReasoningStateElementIds,
  UnknownBoardElementIdError,
} from "@/lib/interview/reasoning-safety";
import {
  getNextInterviewStage,
  transitionInterviewSession,
} from "@/lib/interview/state-machine";
import type { StoredSnapshotImage } from "@/lib/persistence/repositories";
import { AppError } from "@/lib/security/errors";
import { assertAllowedUpload } from "@/lib/security/limits";
import {
  createInitialBoardDiff,
  createSemanticBoardDiff,
} from "@/lib/whiteboard/semantic-diff";
import { normalizedBoardSceneSchema } from "@/lib/whiteboard/schemas";

import type {
  AnalyzeBoardRequest,
  AppendTranscriptEventRequest,
  CreateInterviewRequest,
} from "./schemas";
import type { SapphireServerRuntime } from "./runtime";

const MAX_SNAPSHOT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CLIENT_CLOCK_AHEAD_MS = 60_000;

const DEMO_ENTRY_STAGES = [
  "BRIEFING",
  "REQUIREMENT_CLARIFICATION",
  "INITIAL_DECOMPOSITION",
  "SOLUTION_CONSTRUCTION",
] as const;

function id(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll("-", "")}`;
}

function notFound(): AppError {
  return new AppError({
    code: "SESSION_NOT_FOUND",
    message: "The interview session was not found.",
    status: 404,
    expose: true,
  });
}

function configurationMissing(message: string): AppError {
  return new AppError({
    code: "SESSION_ARTIFACT_MISSING",
    message,
    status: 500,
    expose: false,
  });
}

function assertSessionCanMutate(session: InterviewSession): void {
  if (session.status === "complete" || session.stage === "COMPLETE") {
    throw new AppError({
      code: "SESSION_COMPLETE",
      message: "This interview is already complete.",
      status: 409,
      expose: true,
    });
  }
  if (session.status === "generating_report" || session.stage === "GENERATING_REPORT") {
    throw new AppError({
      code: "REPORT_IN_PROGRESS",
      message: "The interview report is being generated.",
      status: 409,
      retryable: true,
      expose: true,
    });
  }
}

function eventTime(events: readonly SessionEvent[], requestedAt: number): number {
  return Math.max(requestedAt, events.at(-1)?.occurredAt ?? 0);
}

async function appendValidatedEvent(
  runtime: SapphireServerRuntime,
  sessionId: string,
  events: SessionEvent[],
  eventInput: unknown,
): Promise<SessionEvent> {
  const event = sessionEventSchema.parse(eventInput);
  appendSessionEvent(events, event);
  await runtime.persistence.sessions.appendEvent(sessionId, event);
  events.push(event);
  return event;
}

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  code: string,
  publicMessage: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new AppError({
                code,
                message: publicMessage,
                status: 504,
                retryable: true,
                expose: true,
              }),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function validateImageSignature(
  bytes: Uint8Array,
  mimeType: StoredSnapshotImage["mimeType"],
): void {
  const valid =
    (mimeType === "image/png" &&
      hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mimeType === "image/jpeg" && hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) ||
    (mimeType === "image/webp" &&
      hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
      hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50]));
  if (!valid) {
    throw new AppError({
      code: "INVALID_BOARD_IMAGE",
      message: "The board image bytes do not match the declared media type.",
      status: 400,
      expose: true,
    });
  }
}

function decodeBoardImage(
  image: AnalyzeBoardRequest["boardImage"],
): StoredSnapshotImage | undefined {
  if (!image) return undefined;
  if (
    image.dataBase64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      image.dataBase64,
    )
  ) {
    throw new AppError({
      code: "INVALID_BOARD_IMAGE",
      message: "The board image must be valid base64 data.",
      status: 400,
      expose: true,
    });
  }
  const data = Uint8Array.from(Buffer.from(image.dataBase64, "base64"));
  assertAllowedUpload({
    mimeType: image.mimeType,
    byteLength: data.byteLength,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    maximumBytes: MAX_SNAPSHOT_IMAGE_BYTES,
  });
  validateImageSignature(data, image.mimeType);
  return { data, mimeType: image.mimeType };
}

function groundReasoningEvidence(
  stateInput: ReasoningState,
  input: BoardAnalysisInput,
): ReasoningState {
  let boardSafe: ReasoningState;
  try {
    boardSafe = sanitizeReasoningStateElementIds(
      stateInput,
      input.scene,
      "reject",
    ).state;
  } catch (error) {
    if (error instanceof UnknownBoardElementIdError) {
      throw new AppError({
        code: "UNGROUNDED_ANALYSIS",
        message: "The analysis referenced board elements that are not in the current scene.",
        status: 422,
        retryable: true,
        expose: true,
        cause: error,
      });
    }
    throw error;
  }

  const knownTranscriptIds = new Set(input.recentTranscript.map((segment) => segment.id));
  const groundEvidence = (evidence: {
    transcriptSegmentIds: string[];
    boardElementIds: string[];
    snapshotId: string | null;
  }) => {
    const unknownTranscriptIds = evidence.transcriptSegmentIds.filter(
      (segmentId) => !knownTranscriptIds.has(segmentId),
    );
    if (unknownTranscriptIds.length > 0) {
      throw new AppError({
        code: "UNGROUNDED_ANALYSIS",
        message: "The analysis referenced transcript evidence that is not in the supplied window.",
        status: 422,
        retryable: true,
        expose: true,
      });
    }
    return {
      ...evidence,
      snapshotId:
        evidence.boardElementIds.length > 0
          ? input.snapshotId
          : evidence.snapshotId === input.snapshotId
            ? input.snapshotId
            : null,
    };
  };

  return reasoningStateSchema.parse({
    ...boardSafe,
    observations: boardSafe.observations.map((observation) => ({
      ...observation,
      evidence: groundEvidence(observation.evidence),
    })),
    contradictions: boardSafe.contradictions.map((contradiction) => ({
      ...contradiction,
      evidence: groundEvidence(contradiction.evidence),
    })),
    updatedCompetencySignals: boardSafe.updatedCompetencySignals.map((signal) => ({
      ...signal,
      evidence: groundEvidence(signal.evidence),
    })),
  });
}

type PreparedAnalysis = {
  input: BoardAnalysisInput;
  snapshot: BoardSnapshotRecord;
  image: StoredSnapshotImage | undefined;
  baseAnalysisVersion: number;
  triggerReason: string;
  urgency: "wait" | "next_pause" | "interrupt";
};

export class SapphireInterviewService {
  constructor(private readonly runtime: SapphireServerRuntime) {}

  async createInterview(request: CreateInterviewRequest) {
    const blueprint = await withTimeout(
      () =>
        this.runtime.gemini.createInterviewBlueprint({
          scenarioId: request.scenarioId,
          mode: request.mode,
          interviewType: request.interviewType,
          targetRole: request.targetRole,
          experienceLevel: request.experienceLevel,
        }),
      this.runtime.environment.geminiRequestTimeoutMs,
      "BLUEPRINT_TIMEOUT",
      "The interview scenario took too long to prepare. Please try again.",
    );
    if (blueprint.scenarioId !== request.scenarioId) {
      throw new AppError({
        code: "INVALID_BLUEPRINT",
        message: "The interview provider returned a blueprint for a different scenario.",
        status: 502,
        retryable: true,
        expose: false,
      });
    }

    const createdAt = this.runtime.now();
    let session = interviewSessionSchema.parse({
      id: id("session"),
      scenarioId: request.scenarioId,
      mode: request.mode,
      stage: "SETUP",
      status: "active",
      createdAt,
      updatedAt: createdAt,
      latestAnalysisVersion: 0,
    });
    const events: SessionEvent[] = [];

    await this.runtime.persistence.sessions.create(session);
    try {
      await this.runtime.persistence.sessions.saveBlueprint(session.id, blueprint);
      await appendValidatedEvent(this.runtime, session.id, events, {
        ...this.envelope(session.id, events, createdAt),
        type: "session.created",
        payload: {
          scenarioId: session.scenarioId,
          mode: session.mode,
          initialStage: "SETUP",
        },
      });
      await appendValidatedEvent(this.runtime, session.id, events, {
        ...this.envelope(session.id, events, createdAt),
        type: "consent.accepted",
        payload: {
          transcriptStorageAccepted: true,
          microphoneAccepted: request.consent.microphone,
        },
      });

      for (const nextStage of DEMO_ENTRY_STAGES) {
        const from = session.stage;
        session = transitionInterviewSession(session, nextStage, createdAt);
        await appendValidatedEvent(this.runtime, session.id, events, {
          ...this.envelope(session.id, events, createdAt),
          type: "stage.changed",
          payload: {
            from,
            to: nextStage,
            reason: "Prepare the whiteboard-focused system-design exercise.",
            recommendedBy: "application",
          },
        });
      }
      session = await this.runtime.persistence.sessions.replace(session);
    } catch (error) {
      await this.runtime.persistence.snapshots.deleteForSession(session.id).catch(() => 0);
      await this.runtime.persistence.sessions.delete(session.id).catch(() => false);
      throw error;
    }

    return {
      session,
      blueprint,
      providerMode: this.runtime.gemini.mode,
      liveEnabled: this.runtime.environment.enableGeminiLive,
    };
  }

  async getInterview(sessionId: string) {
    const session = await this.requireSession(sessionId);
    const [events, snapshots, blueprint] = await Promise.all([
      this.runtime.persistence.sessions.listEvents(sessionId),
      this.runtime.persistence.snapshots.listRecords(sessionId),
      this.runtime.persistence.sessions.getBlueprint(sessionId),
    ]);
    const timeline = reduceSessionEvents(events);
    if (!blueprint) {
      throw configurationMissing("The interview blueprint is unavailable.");
    }
    return {
      session,
      events,
      snapshots,
      blueprint,
      reasoningState: timeline.latestReasoningState,
      providerMode: this.runtime.gemini.mode,
      liveEnabled: this.runtime.environment.enableGeminiLive,
      reportAvailable: timeline.reportId !== null,
    };
  }

  async appendTranscript(
    sessionId: string,
    request: AppendTranscriptEventRequest,
  ) {
    return this.runtime.mutations.run(sessionId, async () => {
      const session = await this.requireSession(sessionId);
      assertSessionCanMutate(session);
      const segment = transcriptSegmentSchema.parse(request.segment);
      if (segment.sessionId !== sessionId) {
        throw new AppError({
          code: "TRANSCRIPT_SESSION_MISMATCH",
          message: "The transcript segment belongs to a different session.",
          status: 400,
          expose: true,
        });
      }
      const expectedSpeaker =
        request.type === "transcript.input.finalized" ? "candidate" : "interviewer";
      if (segment.speaker !== expectedSpeaker) {
        throw new AppError({
          code: "TRANSCRIPT_SPEAKER_MISMATCH",
          message: `This event requires a ${expectedSpeaker} transcript segment.`,
          status: 400,
          expose: true,
        });
      }
      const now = this.runtime.now();
      if (segment.endedAt > now + MAX_CLIENT_CLOCK_AHEAD_MS) {
        throw new AppError({
          code: "INVALID_TRANSCRIPT_TIME",
          message: "The transcript timestamp is too far ahead of the server clock.",
          status: 400,
          expose: true,
        });
      }
      const events = await this.requireEvents(sessionId);
      const occurredAt = eventTime(events, Math.max(now, segment.endedAt));
      const event = await appendValidatedEvent(this.runtime, sessionId, events, {
        ...this.envelope(sessionId, events, occurredAt),
        type: request.type,
        payload: { segment },
      });
      const updatedSession = await this.runtime.persistence.sessions.replace({
        ...session,
        updatedAt: Math.max(session.updatedAt, occurredAt),
      });
      return { session: updatedSession, event, segment };
    });
  }

  async analyzeBoard(sessionId: string, request: AnalyzeBoardRequest) {
    this.runtime.analysisRateLimiter.assertAllowed(`analysis:${sessionId}`);
    return this.runtime.analysisConcurrency.run(sessionId, async () => {
      const prepared = await this.prepareAnalysis(sessionId, request);
      const startedAt = this.runtime.now();
      this.runtime.logger.info("board.analysis.started", {
        requestId: prepared.input.requestId,
        sessionId,
        model: this.runtime.environment.geminiReasoningModel,
        providerMode: this.runtime.gemini.mode,
        analysisVersion: prepared.input.analysisVersion,
      });

      try {
        const providerState = await withTimeout(
          () => this.runtime.gemini.analyzeBoard(prepared.input),
          this.runtime.environment.geminiRequestTimeoutMs,
          "ANALYSIS_TIMEOUT",
          "Board analysis took too long. Your board is safe; please try again.",
        );
        const grounded = groundReasoningEvidence(
          reasoningStateSchema.parse(providerState),
          prepared.input,
        );
        const reasoningState = enforceReasoningConfidenceThreshold(
          grounded,
          this.runtime.environment.contradictionConfidenceThreshold,
        ).state;
        const persisted = await this.persistAnalysis(sessionId, prepared, reasoningState);
        this.runtime.logger.info("board.analysis.completed", {
          requestId: prepared.input.requestId,
          sessionId,
          model: this.runtime.environment.geminiReasoningModel,
          providerMode: this.runtime.gemini.mode,
          analysisVersion: prepared.input.analysisVersion,
          latencyMs: this.runtime.now() - startedAt,
          status: 200,
        });
        return persisted;
      } catch (error) {
        this.runtime.logger.warn("board.analysis.failed", {
          requestId: prepared.input.requestId,
          sessionId,
          model: this.runtime.environment.geminiReasoningModel,
          providerMode: this.runtime.gemini.mode,
          analysisVersion: prepared.input.analysisVersion,
          latencyMs: this.runtime.now() - startedAt,
          status: error instanceof AppError ? error.status : 500,
          errorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        });
        throw error;
      }
    });
  }

  async finishInterview(sessionId: string, reason = "Candidate ended the interview.") {
    if (this.runtime.analysisConcurrency.isActive(sessionId)) {
      throw new AppError({
        code: "ANALYSIS_IN_PROGRESS",
        message: "Wait for the current board analysis before ending the interview.",
        status: 409,
        retryable: true,
        expose: true,
      });
    }

    const prepared = await this.runtime.mutations.run(sessionId, async () => {
      if (this.runtime.analysisConcurrency.isActive(sessionId)) {
        throw new AppError({
          code: "ANALYSIS_IN_PROGRESS",
          message: "Wait for the current board analysis before ending the interview.",
          status: 409,
          retryable: true,
          expose: true,
        });
      }
      let session = await this.requireSession(sessionId);
      const events = await this.requireEvents(sessionId);
      let timeline = reduceSessionEvents(events);
      const [blueprint, snapshots, existingReport] = await Promise.all([
        this.runtime.persistence.sessions.getBlueprint(sessionId),
        this.runtime.persistence.snapshots.listRecords(sessionId),
        this.runtime.persistence.sessions.getReport(sessionId),
      ]);
      if (!blueprint) throw configurationMissing("The interview blueprint is unavailable.");
      if (session.stage === "COMPLETE") {
        if (!existingReport) throw configurationMissing("The completed report is unavailable.");
        return { session, events, timeline, blueprint, snapshots, existingReport };
      }

      const now = eventTime(events, this.runtime.now());
      if (!timeline.completed) {
        while (session.stage !== "REFLECTION") {
          const next = getNextInterviewStage(session.stage);
          if (!next || next === "GENERATING_REPORT" || next === "COMPLETE") {
            throw new AppError({
              code: "INVALID_INTERVIEW_STATE",
              message: "The interview cannot be completed from its current stage.",
              status: 409,
              expose: true,
            });
          }
          const from = session.stage;
          session = transitionInterviewSession(session, next, now);
          await appendValidatedEvent(this.runtime, sessionId, events, {
            ...this.envelope(sessionId, events, now),
            type: "stage.changed",
            payload: {
              from,
              to: next,
              reason: "Close the interview through the remaining evidence stages.",
              recommendedBy: "application",
            },
          });
        }
        await appendValidatedEvent(this.runtime, sessionId, events, {
          ...this.envelope(sessionId, events, now),
          type: "interview.completed",
          payload: { reason },
        });
      }
      if (session.stage === "REFLECTION") {
        const from = session.stage;
        session = transitionInterviewSession(session, "GENERATING_REPORT", now);
        await appendValidatedEvent(this.runtime, sessionId, events, {
          ...this.envelope(sessionId, events, now),
          type: "stage.changed",
          payload: {
            from,
            to: "GENERATING_REPORT",
            reason: "Generate the evidence-backed interview report.",
            recommendedBy: "application",
          },
        });
      }
      session = await this.runtime.persistence.sessions.replace(session);
      timeline = reduceSessionEvents(events);
      return { session, events, timeline, blueprint, snapshots, existingReport };
    });

    let report = prepared.existingReport;
    if (!report) {
      report = await withTimeout(
        () =>
          this.runtime.gemini.generateFinalReport({
            session: prepared.session,
            blueprint: prepared.blueprint,
            events: prepared.events,
            snapshots: prepared.snapshots,
            finalReasoningState: prepared.timeline.latestReasoningState,
          }),
        this.runtime.environment.geminiRequestTimeoutMs,
        "REPORT_TIMEOUT",
        "Report generation took too long. Please try again.",
      );
      report = validateFinalReportEvidence(
        finalReportSchema.parse(report),
        prepared.timeline,
      );
      await this.runtime.persistence.sessions.saveReport(sessionId, report);
    }

    const finalReport = report;
    const finalSession = await this.runtime.mutations.run(sessionId, async () => {
      let session = await this.requireSession(sessionId);
      const events = await this.requireEvents(sessionId);
      const timeline = reduceSessionEvents(events);
      const now = eventTime(events, this.runtime.now());
      if (timeline.reportId === null) {
        await appendValidatedEvent(this.runtime, sessionId, events, {
          ...this.envelope(sessionId, events, now),
          type: "report.generated",
          payload: { reportId: finalReport.id },
        });
      }
      if (session.stage === "GENERATING_REPORT") {
        const from = session.stage;
        session = transitionInterviewSession(session, "COMPLETE", now);
        await appendValidatedEvent(this.runtime, sessionId, events, {
          ...this.envelope(sessionId, events, now),
          type: "stage.changed",
          payload: {
            from,
            to: "COMPLETE",
            reason: "The evidence-backed report is ready.",
            recommendedBy: "application",
          },
        });
        session = await this.runtime.persistence.sessions.replace(session);
      }
      return session;
    });
    return { report: finalReport, session: finalSession };
  }

  async getReport(sessionId: string) {
    const [session, report, events, snapshots] = await Promise.all([
      this.requireSession(sessionId),
      this.runtime.persistence.sessions.getReport(sessionId),
      this.runtime.persistence.sessions.listEvents(sessionId),
      this.runtime.persistence.snapshots.listRecords(sessionId),
    ]);
    if (!report) {
      throw new AppError({
        code: "REPORT_NOT_READY",
        message: "The interview report is not ready yet.",
        status: 409,
        retryable: true,
        expose: true,
      });
    }
    reduceSessionEvents(events);
    return { report, session, events, snapshots };
  }

  async createLiveToken(sessionId: string) {
    if (!this.runtime.environment.enableGeminiLive) {
      throw new AppError({
        code: "GEMINI_LIVE_DISABLED",
        message: "Live voice is unavailable. Continue with the text fallback.",
        status: 503,
        retryable: false,
        expose: true,
      });
    }
    const session = await this.requireSession(sessionId);
    assertSessionCanMutate(session);
    const blueprint = await this.runtime.persistence.sessions.getBlueprint(sessionId);
    if (!blueprint) throw configurationMissing("The interview blueprint is unavailable.");
    const result = await withTimeout(
      () =>
        this.runtime.gemini.createLiveEphemeralToken({
          sessionId,
          systemInstruction: this.liveSystemInstruction(blueprint),
        }),
      Math.min(this.runtime.environment.geminiRequestTimeoutMs, 10_000),
      "LIVE_TOKEN_TIMEOUT",
      "Live voice could not start in time. Continue with the text fallback.",
    );
    return liveTokenResultSchema.parse(result);
  }

  async deleteInterview(sessionId: string) {
    if (this.runtime.analysisConcurrency.isActive(sessionId)) {
      throw new AppError({
        code: "ANALYSIS_IN_PROGRESS",
        message: "Wait for the current analysis before deleting the session.",
        status: 409,
        retryable: true,
        expose: true,
      });
    }
    return this.runtime.mutations.run(sessionId, async () => {
      await this.requireSession(sessionId);
      const deletedSnapshots = await this.runtime.persistence.snapshots.deleteForSession(
        sessionId,
      );
      const deleted = await this.runtime.persistence.sessions.delete(sessionId);
      if (!deleted) throw notFound();
      return { deleted: true as const, deletedSnapshots };
    });
  }

  private async prepareAnalysis(
    sessionId: string,
    request: AnalyzeBoardRequest,
  ): Promise<PreparedAnalysis> {
    const image = decodeBoardImage(request.boardImage);
    return this.runtime.mutations.run(sessionId, async () => {
      let session = await this.requireSession(sessionId);
      assertSessionCanMutate(session);
      const events = await this.requireEvents(sessionId);
      const timeline = reduceSessionEvents(events);
      if (session.latestAnalysisVersion !== timeline.latestAnalysisVersion) {
        session = await this.runtime.persistence.sessions.replace({
          ...session,
          latestAnalysisVersion: timeline.latestAnalysisVersion,
        });
      }
      const [snapshots, blueprint] = await Promise.all([
        this.runtime.persistence.snapshots.listRecords(sessionId),
        this.runtime.persistence.sessions.getBlueprint(sessionId),
      ]);
      if (!blueprint) throw configurationMissing("The interview blueprint is unavailable.");

      const scene = normalizedBoardSceneSchema.parse({
        ...request.scene,
        capturedAt: this.runtime.now(),
      });
      const priorSnapshot = snapshots.at(-1) ?? null;
      const diff = priorSnapshot
        ? createSemanticBoardDiff(priorSnapshot.scene, scene)
        : createInitialBoardDiff(scene);
      const analysisVersion = timeline.latestAnalysisVersion + 1;
      const snapshot = boardSnapshotRecordSchema.parse({
        id: id("snapshot"),
        sessionId,
        createdAt: scene.capturedAt,
        scene,
        imageObjectPath: null,
        imageMimeType: null,
        analysisVersion,
      });
      const recentTranscript = [...timeline.transcriptSegments.values()]
        .sort((left, right) => left.endedAt - right.endedAt || left.id.localeCompare(right.id))
        .slice(-100);
      const activeConstraints = blueprint.constraints
        .filter((constraint) => timeline.injectedConstraintIds.has(constraint.id))
        .map(({ id: constraintId, text }) => ({ id: constraintId, text }));
      const input = boardAnalysisInputSchema.parse({
        requestId: id("analysis-request"),
        sessionId,
        analysisVersion,
        snapshotId: snapshot.id,
        problemStatement: blueprint.problemStatement,
        boardImage: request.boardImage,
        scene,
        diff,
        previousReasoningState: timeline.latestReasoningState,
        currentStage: session.stage,
        recentTranscript,
        olderSessionSummary: `The session contains ${events.length} validated events and ${snapshots.length} prior analyzed snapshots.`,
        hiddenRubric: blueprint.hiddenRubric,
        activeConstraints,
      });
      return {
        input,
        snapshot,
        image,
        baseAnalysisVersion: timeline.latestAnalysisVersion,
        triggerReason: request.triggerReason,
        urgency: request.urgency,
      };
    });
  }

  private async persistAnalysis(
    sessionId: string,
    prepared: PreparedAnalysis,
    reasoningState: ReasoningState,
  ) {
    return this.runtime.mutations.run(sessionId, async () => {
      const session = await this.requireSession(sessionId);
      assertSessionCanMutate(session);
      const events = await this.requireEvents(sessionId);
      const timeline = reduceSessionEvents(events);
      if (
        timeline.latestAnalysisVersion !== prepared.baseAnalysisVersion ||
        session.latestAnalysisVersion !== prepared.baseAnalysisVersion
      ) {
        throw new AppError({
          code: "STALE_ANALYSIS",
          message: "A newer board analysis superseded this response.",
          status: 409,
          retryable: true,
          expose: true,
        });
      }
      const occurredAt = eventTime(events, this.runtime.now());
      const snapshot = await this.runtime.persistence.snapshots.save(
        prepared.snapshot,
        prepared.image,
      );
      await appendValidatedEvent(this.runtime, sessionId, events, {
        ...this.envelope(sessionId, events, occurredAt),
        type: "board.snapshot.created",
        payload: { snapshot },
      });
      const previousSnapshots = await this.runtime.persistence.snapshots.listRecords(sessionId);
      const previousSnapshotId =
        previousSnapshots.filter((candidate) => candidate.id !== snapshot.id).at(-1)?.id ?? null;
      await appendValidatedEvent(this.runtime, sessionId, events, {
        ...this.envelope(sessionId, events, occurredAt),
        type: "board.semantic_diff.created",
        payload: {
          snapshotId: snapshot.id,
          previousSnapshotId,
          diff: prepared.input.diff,
        },
      });
      await appendValidatedEvent(this.runtime, sessionId, events, {
        ...this.envelope(sessionId, events, occurredAt),
        type: "board.analysis.requested",
        payload: {
          analysisVersion: prepared.input.analysisVersion,
          snapshotId: snapshot.id,
          reason: prepared.triggerReason,
          urgency: prepared.urgency,
        },
      });
      await appendValidatedEvent(this.runtime, sessionId, events, {
        ...this.envelope(sessionId, events, occurredAt),
        type: "board.analysis.completed",
        payload: {
          analysisVersion: prepared.input.analysisVersion,
          snapshotId: snapshot.id,
          reasoningState,
        },
      });
      if (reasoningState.recommendedProbe.focusElementIds.length > 0) {
        await appendValidatedEvent(this.runtime, sessionId, events, {
          ...this.envelope(sessionId, events, occurredAt),
          type: "board.elements.focused",
          payload: {
            analysisVersion: prepared.input.analysisVersion,
            snapshotId: snapshot.id,
            elementIds: reasoningState.recommendedProbe.focusElementIds,
            message:
              reasoningState.recommendedProbe.question ??
              reasoningState.recommendedProbe.reason,
          },
        });
      }
      const revision = reasoningState.observations.find(
        (observation) => observation.category === "revision",
      );
      if (revision) {
        await appendValidatedEvent(this.runtime, sessionId, events, {
          ...this.envelope(sessionId, events, occurredAt),
          type: "candidate.revision.detected",
          payload: { observationId: revision.id, evidence: revision.evidence },
        });
      }
      const updatedSession = await this.runtime.persistence.sessions.replace({
        ...session,
        latestAnalysisVersion: prepared.input.analysisVersion,
        updatedAt: Math.max(session.updatedAt, occurredAt),
      });
      return {
        analysisVersion: prepared.input.analysisVersion,
        snapshot,
        reasoningState,
        session: updatedSession,
      };
    });
  }

  private async requireSession(sessionId: string): Promise<InterviewSession> {
    return (await this.runtime.persistence.sessions.get(sessionId)) ?? Promise.reject(notFound());
  }

  private async requireEvents(sessionId: string): Promise<SessionEvent[]> {
    const events = await this.runtime.persistence.sessions.listEvents(sessionId);
    if (events.length === 0) throw configurationMissing("The interview timeline is unavailable.");
    reduceSessionEvents(events);
    return events;
  }

  private envelope(
    sessionId: string,
    events: readonly SessionEvent[],
    occurredAt: number,
  ) {
    return {
      id: id("event"),
      sessionId,
      sequence: events.length + 1,
      occurredAt: eventTime(events, occurredAt),
    };
  }

  private liveSystemInstruction(blueprint: InterviewBlueprint): string {
    return [
      "You are Sapphire, a concise system-design interviewer.",
      `Scenario: ${blueprint.problemStatement}`,
      "Ask one question at a time and pause after asking.",
      "Reason only from finalized transcript text and board-analysis tool results.",
      "Never claim to see a board element unless a tool result identifies it.",
      "Do not reveal the ideal solution or evaluate private thought, emotion, accent, or identity.",
      "Use request_board_analysis before making a board-grounded claim.",
      "Acknowledge evidence-backed revisions briefly, then continue the interview.",
    ].join("\n");
  }
}
