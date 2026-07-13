import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";

import {
  boardSnapshotRecordSchema,
  domainIdSchema,
  type BoardSnapshotRecord,
} from "@/lib/interview/schemas";
import { AppError } from "@/lib/security/errors";
import { assertAllowedUpload } from "@/lib/security/limits";

import type { SnapshotRepository, StoredSnapshotImage } from "./repositories";

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export type GoogleCloudSnapshotRepositoryOptions = {
  projectId: string;
  bucketName?: string;
  databaseId?: string;
  firestore?: Firestore;
  storage?: Storage;
};

function extensionFor(mimeType: StoredSnapshotImage["mimeType"]): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function objectPathFor(record: BoardSnapshotRecord, mimeType: StoredSnapshotImage["mimeType"]): string {
  return `sessions/${record.sessionId}/snapshots/${record.id}.${extensionFor(mimeType)}`;
}

export class GoogleCloudSnapshotRepository implements SnapshotRepository {
  private readonly firestore: Firestore;
  private readonly storage: Storage | null;
  private readonly bucketName: string | null;

  constructor(options: GoogleCloudSnapshotRepositoryOptions) {
    if (!options.projectId.trim()) {
      throw new AppError({
        code: "GOOGLE_CLOUD_NOT_CONFIGURED",
        message: "A Google Cloud project is required for snapshot persistence.",
        status: 500,
        expose: false,
      });
    }
    this.firestore = options.firestore ?? new Firestore({
      projectId: options.projectId,
      databaseId: options.databaseId ?? "(default)",
    });
    this.bucketName = options.bucketName?.trim() || null;
    this.storage = this.bucketName ? options.storage ?? new Storage({ projectId: options.projectId }) : null;
  }

  async save(
    record: BoardSnapshotRecord,
    image?: StoredSnapshotImage,
  ): Promise<BoardSnapshotRecord> {
    const validatedSessionId = domainIdSchema.parse(record.sessionId);
    const session = await this.firestore.collection("sessions").doc(validatedSessionId).get();
    if (!session.exists) {
      throw new AppError({
        code: "SESSION_NOT_FOUND",
        message: "The interview session was not found.",
        status: 404,
        expose: true,
      });
    }
    let objectPath: string | null = null;
    let imageMimeType: BoardSnapshotRecord["imageMimeType"] = null;
    if (image) {
      if (!this.storage || !this.bucketName) {
        throw new AppError({
          code: "CLOUD_STORAGE_DISABLED",
          message: "Cloud Storage must be configured before saving snapshot images.",
          status: 503,
          expose: false,
        });
      }
      assertAllowedUpload({
        mimeType: image.mimeType,
        byteLength: image.data.byteLength,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
        maximumBytes: MAX_SNAPSHOT_BYTES,
      });
      objectPath = objectPathFor(record, image.mimeType);
      imageMimeType = image.mimeType;
      try {
        await this.storage.bucket(this.bucketName).file(objectPath).save(Buffer.from(image.data), {
          resumable: false,
          validation: "crc32c",
          contentType: image.mimeType,
          metadata: { cacheControl: "private, max-age=0, no-store" },
        });
      } catch (error) {
        throw this.normalizeCloudError(error, "GCS_UPLOAD_FAILED");
      }
    }

    const validated = boardSnapshotRecordSchema.parse({
      ...record,
      imageObjectPath: objectPath,
      imageMimeType,
    });
    try {
      await this.snapshotCollection(record.sessionId).doc(record.id).set(validated, { merge: false });
      return validated;
    } catch (error) {
      if (image && objectPath && this.storage && this.bucketName) {
        await this.storage.bucket(this.bucketName).file(objectPath).delete({ ignoreNotFound: true }).catch(() => undefined);
      }
      throw this.normalizeCloudError(error, "SNAPSHOT_METADATA_WRITE_FAILED");
    }
  }

  async getRecord(sessionId: string, snapshotId: string): Promise<BoardSnapshotRecord | null> {
    domainIdSchema.parse(sessionId);
    domainIdSchema.parse(snapshotId);
    try {
      const snapshot = await this.snapshotCollection(sessionId).doc(snapshotId).get();
      return snapshot.exists ? boardSnapshotRecordSchema.parse(snapshot.data()) : null;
    } catch (error) {
      throw this.normalizeCloudError(error, "SNAPSHOT_METADATA_READ_FAILED");
    }
  }

  async getImage(sessionId: string, snapshotId: string): Promise<StoredSnapshotImage | null> {
    const record = await this.getRecord(sessionId, snapshotId);
    if (!record?.imageObjectPath || !record.imageMimeType) {
      return null;
    }
    const expectedPrefix = `sessions/${sessionId}/snapshots/`;
    if (!record.imageObjectPath.startsWith(expectedPrefix) || record.imageObjectPath.includes("..")) {
      throw new AppError({
        code: "INVALID_SNAPSHOT_OBJECT_PATH",
        message: "The stored snapshot path is invalid.",
        status: 500,
        expose: false,
      });
    }
    if (!this.storage || !this.bucketName) {
      throw new AppError({
        code: "CLOUD_STORAGE_DISABLED",
        message: "Cloud Storage is not configured for snapshot retrieval.",
        status: 503,
        expose: false,
      });
    }
    try {
      const [data] = await this.storage.bucket(this.bucketName).file(record.imageObjectPath).download();
      return { data: Uint8Array.from(data), mimeType: record.imageMimeType };
    } catch (error) {
      throw this.normalizeCloudError(error, "GCS_DOWNLOAD_FAILED");
    }
  }

  async listRecords(sessionId: string): Promise<BoardSnapshotRecord[]> {
    domainIdSchema.parse(sessionId);
    try {
      const result = await this.snapshotCollection(sessionId).orderBy("createdAt", "asc").get();
      return result.docs.map((document) => boardSnapshotRecordSchema.parse(document.data()));
    } catch (error) {
      throw this.normalizeCloudError(error, "SNAPSHOT_METADATA_READ_FAILED");
    }
  }

  async deleteForSession(sessionId: string): Promise<number> {
    domainIdSchema.parse(sessionId);
    const records = await this.listRecords(sessionId);
    try {
      if (this.storage && this.bucketName) {
        await this.storage.bucket(this.bucketName).deleteFiles({
          prefix: `sessions/${sessionId}/snapshots/`,
          force: true,
        });
      }
      const batch = this.firestore.batch();
      for (const record of records) {
        batch.delete(this.snapshotCollection(sessionId).doc(record.id));
      }
      if (records.length > 0) {
        await batch.commit();
      }
      return records.length;
    } catch (error) {
      throw this.normalizeCloudError(error, "SNAPSHOT_DELETE_FAILED");
    }
  }

  private snapshotCollection(sessionId: string) {
    return this.firestore.collection("sessions").doc(sessionId).collection("snapshots");
  }

  private normalizeCloudError(error: unknown, code: string): AppError {
    if (error instanceof AppError) {
      return error;
    }
    return new AppError({
      code,
      message: "Google Cloud snapshot persistence is unavailable. Verify ADC, private bucket access, and project configuration.",
      status: 503,
      retryable: true,
      expose: false,
      cause: error,
    });
  }
}
