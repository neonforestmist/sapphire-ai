import { getGeminiGateway, type GeminiGateway } from "@/lib/gemini";
import {
  getPersistenceRepositories,
  type PersistenceRepositories,
} from "@/lib/persistence/factory";
import {
  getServerEnvironment,
  type ServerEnvironment,
} from "@/lib/security/env";
import {
  InMemoryRateLimiter,
  KeyedConcurrencyGuard,
} from "@/lib/security/limits";
import {
  createStructuredLogger,
  type StructuredLogger,
} from "@/lib/security/logging";

import { KeyedSerialExecutor } from "./serial-executor";

export type SapphireServerRuntime = {
  environment: ServerEnvironment;
  gemini: GeminiGateway;
  persistence: PersistenceRepositories;
  analysisConcurrency: KeyedConcurrencyGuard;
  mutations: KeyedSerialExecutor;
  analysisRateLimiter: InMemoryRateLimiter;
  requestRateLimiter: InMemoryRateLimiter;
  logger: StructuredLogger;
  now: () => number;
};

export function createSapphireServerRuntime(options: {
  environment?: ServerEnvironment;
  gemini?: GeminiGateway;
  persistence?: PersistenceRepositories;
  now?: () => number;
  logger?: StructuredLogger;
} = {}): SapphireServerRuntime {
  const environment = options.environment ?? getServerEnvironment();
  return {
    environment,
    gemini: options.gemini ?? getGeminiGateway(),
    persistence: options.persistence ?? getPersistenceRepositories(),
    analysisConcurrency: new KeyedConcurrencyGuard(),
    mutations: new KeyedSerialExecutor(),
    analysisRateLimiter: new InMemoryRateLimiter({
      limit: environment.analysisRateLimitPerMinute,
      windowMs: 60_000,
      maximumKeys: 10_000,
    }),
    requestRateLimiter: new InMemoryRateLimiter({
      limit: Math.max(60, environment.analysisRateLimitPerMinute * 3),
      windowMs: 60_000,
      maximumKeys: 20_000,
    }),
    logger: options.logger ?? createStructuredLogger("sapphire-ai-api"),
    now: options.now ?? (() => Date.now()),
  };
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __sapphireServerRuntime?: SapphireServerRuntime;
};

/** One singleton owns mock-mode memory, rate windows, and concurrency state. */
export function getSapphireServerRuntime(): SapphireServerRuntime {
  runtimeGlobal.__sapphireServerRuntime ??= createSapphireServerRuntime();
  return runtimeGlobal.__sapphireServerRuntime;
}
