import {
  boardSnapshotRecordSchema,
  finalReportSchema,
  interviewBlueprintSchema,
  interviewSessionSchema,
  sessionEventSchema,
  type BoardSnapshotRecord,
  type FinalReport,
  type InterviewBlueprint,
  type InterviewSession,
  type SessionEvent,
} from "@/lib/interview/schemas";
import { AppError } from "@/lib/security/errors";

import type {
  SessionRepository,
  SnapshotRepository,
  StoredSnapshotImage,
} from "./repositories";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, InterviewSession>();
  private readonly events = new Map<string, SessionEvent[]>();
  private readonly blueprints = new Map<string, InterviewBlueprint>();
  private readonly reports = new Map<string, FinalReport>();

  async create(session: InterviewSession): Promise<InterviewSession> {
    const validated = interviewSessionSchema.parse(session);
    if (this.sessions.has(validated.id)) {
      throw new AppError({
        code: "SESSION_ALREADY_EXISTS",
        message: "A session with this ID already exists.",
        status: 409,
        expose: true,
      });
    }
    this.sessions.set(validated.id, clone(validated));
    this.events.set(validated.id, []);
    return clone(validated);
  }

  async get(sessionId: string): Promise<InterviewSession | null> {
    const session = this.sessions.get(sessionId);
    return session ? clone(session) : null;
  }

  async replace(session: InterviewSession): Promise<InterviewSession> {
    const validated = interviewSessionSchema.parse(session);
    if (!this.sessions.has(validated.id)) {
      throw new AppError({
        code: "SESSION_NOT_FOUND",
        message: "The interview session was not found.",
        status: 404,
        expose: true,
      });
    }
    this.sessions.set(validated.id, clone(validated));
    return clone(validated);
  }

  async appendEvent(sessionId: string, event: SessionEvent): Promise<SessionEvent> {
    if (!this.sessions.has(sessionId)) {
      throw new AppError({
        code: "SESSION_NOT_FOUND",
        message: "The interview session was not found.",
        status: 404,
        expose: true,
      });
    }
    const validated = sessionEventSchema.parse(event);
    if (validated.sessionId !== sessionId) {
      throw new AppError({
        code: "EVENT_SESSION_MISMATCH",
        message: "The event does not belong to this interview session.",
        status: 400,
        expose: true,
      });
    }

    const events = this.events.get(sessionId) ?? [];
    if (events.some((existing) => existing.id === validated.id)) {
      throw new AppError({
        code: "EVENT_ALREADY_EXISTS",
        message: "An event with this ID already exists.",
        status: 409,
        expose: true,
      });
    }
    if (validated.sequence !== events.length + 1) {
      throw new AppError({
        code: "EVENT_SEQUENCE_CONFLICT",
        message: "The event sequence is stale. Reload the session and try again.",
        status: 409,
        retryable: true,
        expose: true,
      });
    }
    events.push(clone(validated));
    this.events.set(sessionId, events);
    return clone(validated);
  }

  async listEvents(sessionId: string): Promise<SessionEvent[]> {
    if (!this.sessions.has(sessionId)) {
      return [];
    }
    return clone(this.events.get(sessionId) ?? []);
  }

  async saveBlueprint(
    sessionId: string,
    blueprint: InterviewBlueprint,
  ): Promise<InterviewBlueprint> {
    this.assertSessionExists(sessionId);
    const validated = interviewBlueprintSchema.parse(blueprint);
    if (validated.scenarioId !== this.sessions.get(sessionId)?.scenarioId) {
      throw new AppError({
        code: "BLUEPRINT_SESSION_MISMATCH",
        message: "The interview blueprint does not match this session.",
        status: 400,
        expose: true,
      });
    }
    this.blueprints.set(sessionId, clone(validated));
    return clone(validated);
  }

  async getBlueprint(sessionId: string): Promise<InterviewBlueprint | null> {
    const blueprint = this.blueprints.get(sessionId);
    return blueprint ? clone(blueprint) : null;
  }

  async saveReport(sessionId: string, report: FinalReport): Promise<FinalReport> {
    this.assertSessionExists(sessionId);
    const validated = finalReportSchema.parse(report);
    if (validated.sessionId !== sessionId) {
      throw new AppError({
        code: "REPORT_SESSION_MISMATCH",
        message: "The report does not belong to this interview session.",
        status: 400,
        expose: true,
      });
    }
    this.reports.set(sessionId, clone(validated));
    return clone(validated);
  }

  async getReport(sessionId: string): Promise<FinalReport | null> {
    const report = this.reports.get(sessionId);
    return report ? clone(report) : null;
  }

  async delete(sessionId: string): Promise<boolean> {
    this.events.delete(sessionId);
    this.blueprints.delete(sessionId);
    this.reports.delete(sessionId);
    return this.sessions.delete(sessionId);
  }

  private assertSessionExists(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new AppError({
        code: "SESSION_NOT_FOUND",
        message: "The interview session was not found.",
        status: 404,
        expose: true,
      });
    }
  }
}

type MemorySnapshot = {
  record: BoardSnapshotRecord;
  image: StoredSnapshotImage | null;
};

export class InMemorySnapshotRepository implements SnapshotRepository {
  private readonly bySession = new Map<string, Map<string, MemorySnapshot>>();

  async save(
    record: BoardSnapshotRecord,
    image?: StoredSnapshotImage,
  ): Promise<BoardSnapshotRecord> {
    const normalizedRecord = boardSnapshotRecordSchema.parse({
      ...record,
      imageObjectPath: image
        ? `memory://sessions/${record.sessionId}/snapshots/${record.id}`
        : null,
      imageMimeType: image?.mimeType ?? null,
    });
    const snapshots = this.bySession.get(record.sessionId) ?? new Map<string, MemorySnapshot>();
    snapshots.set(record.id, {
      record: clone(normalizedRecord),
      image: image
        ? { data: Uint8Array.from(image.data), mimeType: image.mimeType }
        : null,
    });
    this.bySession.set(record.sessionId, snapshots);
    return clone(normalizedRecord);
  }

  async getRecord(sessionId: string, snapshotId: string): Promise<BoardSnapshotRecord | null> {
    const snapshot = this.bySession.get(sessionId)?.get(snapshotId);
    return snapshot ? clone(snapshot.record) : null;
  }

  async getImage(sessionId: string, snapshotId: string): Promise<StoredSnapshotImage | null> {
    const image = this.bySession.get(sessionId)?.get(snapshotId)?.image;
    return image
      ? { data: Uint8Array.from(image.data), mimeType: image.mimeType }
      : null;
  }

  async listRecords(sessionId: string): Promise<BoardSnapshotRecord[]> {
    return [...(this.bySession.get(sessionId)?.values() ?? [])]
      .map((snapshot) => clone(snapshot.record))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  async deleteForSession(sessionId: string): Promise<number> {
    const count = this.bySession.get(sessionId)?.size ?? 0;
    this.bySession.delete(sessionId);
    return count;
  }
}
