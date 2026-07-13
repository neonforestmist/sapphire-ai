import type {
  BoardSnapshotRecord,
  FinalReport,
  InterviewBlueprint,
  InterviewSession,
  SessionEvent,
} from "@/lib/interview/schemas";

export type StoredSnapshotImage = {
  data: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
};

export interface SessionRepository {
  create(session: InterviewSession): Promise<InterviewSession>;
  get(sessionId: string): Promise<InterviewSession | null>;
  replace(session: InterviewSession): Promise<InterviewSession>;
  appendEvent(sessionId: string, event: SessionEvent): Promise<SessionEvent>;
  listEvents(sessionId: string): Promise<SessionEvent[]>;
  saveBlueprint(sessionId: string, blueprint: InterviewBlueprint): Promise<InterviewBlueprint>;
  getBlueprint(sessionId: string): Promise<InterviewBlueprint | null>;
  saveReport(sessionId: string, report: FinalReport): Promise<FinalReport>;
  getReport(sessionId: string): Promise<FinalReport | null>;
  delete(sessionId: string): Promise<boolean>;
}

export interface SnapshotRepository {
  save(
    record: BoardSnapshotRecord,
    image?: StoredSnapshotImage,
  ): Promise<BoardSnapshotRecord>;
  getRecord(sessionId: string, snapshotId: string): Promise<BoardSnapshotRecord | null>;
  getImage(sessionId: string, snapshotId: string): Promise<StoredSnapshotImage | null>;
  listRecords(sessionId: string): Promise<BoardSnapshotRecord[]>;
  deleteForSession(sessionId: string): Promise<number>;
}
