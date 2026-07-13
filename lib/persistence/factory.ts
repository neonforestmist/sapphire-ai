import { getServerEnvironment, type ServerEnvironment } from "@/lib/security/env";
import { AppError } from "@/lib/security/errors";

import { FirestoreSessionRepository } from "./firestore";
import { GoogleCloudSnapshotRepository } from "./google-cloud-snapshots";
import { InMemorySessionRepository, InMemorySnapshotRepository } from "./memory";
import type { SessionRepository, SnapshotRepository } from "./repositories";

export type PersistenceRepositories = {
  sessions: SessionRepository;
  snapshots: SnapshotRepository;
  mode: "memory" | "firestore";
};

export function createPersistenceRepositories(
  environment: ServerEnvironment,
): PersistenceRepositories {
  if (!environment.enableFirestore) {
    if (environment.enableCloudStorage) {
      throw new AppError({
        code: "INVALID_PERSISTENCE_CONFIGURATION",
        message: "Cloud Storage snapshots require Firestore metadata persistence.",
        status: 500,
        expose: false,
      });
    }
    return {
      sessions: new InMemorySessionRepository(),
      snapshots: new InMemorySnapshotRepository(),
      mode: "memory",
    };
  }

  if (!environment.googleCloudProject) {
    throw new AppError({
      code: "GOOGLE_CLOUD_NOT_CONFIGURED",
      message: "GOOGLE_CLOUD_PROJECT is required for Firestore persistence.",
      status: 500,
      expose: false,
    });
  }
  if (environment.enableCloudStorage && !environment.gcsBucket) {
    throw new AppError({
      code: "GOOGLE_CLOUD_NOT_CONFIGURED",
      message: "GCS_BUCKET is required when Cloud Storage snapshots are enabled.",
      status: 500,
      expose: false,
    });
  }

  return {
    sessions: new FirestoreSessionRepository({
      projectId: environment.googleCloudProject,
      databaseId: environment.firestoreDatabaseId,
    }),
    snapshots: new GoogleCloudSnapshotRepository({
      projectId: environment.googleCloudProject,
      databaseId: environment.firestoreDatabaseId,
      ...(environment.gcsBucket ? { bucketName: environment.gcsBucket } : {}),
    }),
    mode: "firestore",
  };
}

const persistenceGlobal = globalThis as typeof globalThis & {
  __sapphirePersistenceRepositories?: PersistenceRepositories;
};

/** One process-wide instance keeps local memory sessions alive across route modules. */
export function getPersistenceRepositories(): PersistenceRepositories {
  persistenceGlobal.__sapphirePersistenceRepositories ??=
    createPersistenceRepositories(getServerEnvironment());
  return persistenceGlobal.__sapphirePersistenceRepositories;
}
