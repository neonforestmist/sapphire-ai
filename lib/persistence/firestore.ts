import { Firestore } from "@google-cloud/firestore";

import {
  finalReportSchema,
  interviewBlueprintSchema,
  interviewSessionSchema,
  sessionEventSchema,
  type FinalReport,
  type InterviewBlueprint,
  type InterviewSession,
  type SessionEvent,
} from "@/lib/interview/schemas";
import { AppError } from "@/lib/security/errors";

import type { SessionRepository } from "./repositories";

export type FirestoreSessionRepositoryOptions = {
  projectId: string;
  databaseId?: string;
  client?: Firestore;
};

export class FirestoreSessionRepository implements SessionRepository {
  private readonly client: Firestore;

  constructor(options: FirestoreSessionRepositoryOptions) {
    if (!options.projectId.trim()) {
      throw new AppError({
        code: "FIRESTORE_NOT_CONFIGURED",
        message: "A Google Cloud project is required for Firestore persistence.",
        status: 500,
        expose: false,
      });
    }
    this.client = options.client ?? new Firestore({
      projectId: options.projectId,
      databaseId: options.databaseId ?? "(default)",
    });
  }

  async create(session: InterviewSession): Promise<InterviewSession> {
    const validated = interviewSessionSchema.parse(session);
    const sessionRef = this.client.collection("sessions").doc(validated.id);
    const counterRef = sessionRef.collection("internal").doc("event-counter");
    try {
      await this.client.runTransaction(async (transaction) => {
        const existing = await transaction.get(sessionRef);
        if (existing.exists) {
          throw new AppError({
            code: "SESSION_ALREADY_EXISTS",
            message: "A session with this ID already exists.",
            status: 409,
            expose: true,
          });
        }
        transaction.create(sessionRef, validated);
        transaction.create(counterRef, { sequence: 0 });
      });
      return structuredClone(validated);
    } catch (error) {
      throw this.normalizeFirestoreError(error);
    }
  }

  async get(sessionId: string): Promise<InterviewSession | null> {
    try {
      const snapshot = await this.client.collection("sessions").doc(sessionId).get();
      if (!snapshot.exists) {
        return null;
      }
      return interviewSessionSchema.parse(snapshot.data());
    } catch (error) {
      throw this.normalizeFirestoreError(error);
    }
  }

  async replace(session: InterviewSession): Promise<InterviewSession> {
    const validated = interviewSessionSchema.parse(session);
    const reference = this.client.collection("sessions").doc(validated.id);
    try {
      await this.client.runTransaction(async (transaction) => {
        const current = await transaction.get(reference);
        if (!current.exists) {
          throw new AppError({
            code: "SESSION_NOT_FOUND",
            message: "The interview session was not found.",
            status: 404,
            expose: true,
          });
        }
        transaction.set(reference, validated, { merge: false });
      });
      return structuredClone(validated);
    } catch (error) {
      throw this.normalizeFirestoreError(error);
    }
  }

  async appendEvent(sessionId: string, event: SessionEvent): Promise<SessionEvent> {
    const validated = sessionEventSchema.parse(event);
    if (validated.sessionId !== sessionId) {
      throw new AppError({
        code: "EVENT_SESSION_MISMATCH",
        message: "The event does not belong to this interview session.",
        status: 400,
        expose: true,
      });
    }

    const sessionRef = this.client.collection("sessions").doc(sessionId);
    const counterRef = sessionRef.collection("internal").doc("event-counter");
    const eventRef = sessionRef
      .collection("events")
      .doc(validated.id);
    try {
      await this.client.runTransaction(async (transaction) => {
        const [session, counter, existingEvent] = await Promise.all([
          transaction.get(sessionRef),
          transaction.get(counterRef),
          transaction.get(eventRef),
        ]);
        if (!session.exists) {
          throw new AppError({
            code: "SESSION_NOT_FOUND",
            message: "The interview session was not found.",
            status: 404,
            expose: true,
          });
        }
        if (existingEvent.exists) {
          throw new AppError({
            code: "EVENT_ALREADY_EXISTS",
            message: "An event with this ID already exists.",
            status: 409,
            expose: true,
          });
        }
        const priorSequence = counter.exists ? Number(counter.get("sequence")) : 0;
        if (!Number.isSafeInteger(priorSequence) || validated.sequence !== priorSequence + 1) {
          throw new AppError({
            code: "EVENT_SEQUENCE_CONFLICT",
            message: "The event sequence is stale. Reload the session and try again.",
            status: 409,
            retryable: true,
            expose: true,
          });
        }
        transaction.create(eventRef, validated);
        transaction.set(counterRef, { sequence: validated.sequence }, { merge: false });
      });
      return structuredClone(validated);
    } catch (error) {
      throw this.normalizeFirestoreError(error);
    }
  }

  async listEvents(sessionId: string): Promise<SessionEvent[]> {
    try {
      const session = await this.client.collection("sessions").doc(sessionId).get();
      if (!session.exists) {
        return [];
      }
      const result = await session.ref.collection("events").orderBy("sequence", "asc").get();
      return result.docs.map((document) => sessionEventSchema.parse(document.data()));
    } catch (error) {
      throw this.normalizeFirestoreError(error);
    }
  }

  async saveBlueprint(
    sessionId: string,
    blueprint: InterviewBlueprint,
  ): Promise<InterviewBlueprint> {
    const validated = interviewBlueprintSchema.parse(blueprint);
    const session = await this.get(sessionId);
    if (!session) {
      throw new AppError({
        code: "SESSION_NOT_FOUND",
        message: "The interview session was not found.",
        status: 404,
        expose: true,
      });
    }
    if (validated.scenarioId !== session.scenarioId) {
      throw new AppError({
        code: "BLUEPRINT_SESSION_MISMATCH",
        message: "The interview blueprint does not match this session.",
        status: 400,
        expose: true,
      });
    }
    try {
      await this.artifacts(sessionId).doc("blueprint").set(validated, { merge: false });
      return structuredClone(validated);
    } catch (error) {
      throw this.normalizeFirestoreError(error);
    }
  }

  async getBlueprint(sessionId: string): Promise<InterviewBlueprint | null> {
    try {
      const document = await this.artifacts(sessionId).doc("blueprint").get();
      return document.exists ? interviewBlueprintSchema.parse(document.data()) : null;
    } catch (error) {
      throw this.normalizeFirestoreError(error);
    }
  }

  async saveReport(sessionId: string, report: FinalReport): Promise<FinalReport> {
    const validated = finalReportSchema.parse(report);
    if (validated.sessionId !== sessionId) {
      throw new AppError({
        code: "REPORT_SESSION_MISMATCH",
        message: "The report does not belong to this interview session.",
        status: 400,
        expose: true,
      });
    }
    if (!(await this.get(sessionId))) {
      throw new AppError({
        code: "SESSION_NOT_FOUND",
        message: "The interview session was not found.",
        status: 404,
        expose: true,
      });
    }
    try {
      await this.artifacts(sessionId).doc("report").set(validated, { merge: false });
      return structuredClone(validated);
    } catch (error) {
      throw this.normalizeFirestoreError(error);
    }
  }

  async getReport(sessionId: string): Promise<FinalReport | null> {
    try {
      const document = await this.artifacts(sessionId).doc("report").get();
      return document.exists ? finalReportSchema.parse(document.data()) : null;
    } catch (error) {
      throw this.normalizeFirestoreError(error);
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    const reference = this.client.collection("sessions").doc(sessionId);
    try {
      const exists = (await reference.get()).exists;
      if (!exists) {
        return false;
      }
      await this.client.recursiveDelete(reference);
      return true;
    } catch (error) {
      throw this.normalizeFirestoreError(error);
    }
  }

  private normalizeFirestoreError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }
    return new AppError({
      code: "FIRESTORE_OPERATION_FAILED",
      message: "Firestore persistence is unavailable. Verify ADC, project access, and Firestore configuration.",
      status: 503,
      retryable: true,
      expose: false,
      cause: error,
    });
  }

  private artifacts(sessionId: string) {
    return this.client.collection("sessions").doc(sessionId).collection("artifacts");
  }
}
