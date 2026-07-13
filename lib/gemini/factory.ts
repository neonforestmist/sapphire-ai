import { getServerEnvironment, type ServerEnvironment } from "@/lib/security/env";

import type { GeminiGateway } from "./gateway";
import { MockGeminiGateway } from "./mock-gateway";
import { createRealGeminiGateway } from "./real-gateway";

export function createGeminiGateway(
  environment: ServerEnvironment = getServerEnvironment(),
): GeminiGateway {
  return environment.geminiMode === "mock"
    ? new MockGeminiGateway()
    : createRealGeminiGateway(environment);
}

const geminiGlobal = globalThis as typeof globalThis & {
  __sapphireGeminiGateway?: GeminiGateway;
};

export function getGeminiGateway(): GeminiGateway {
  geminiGlobal.__sapphireGeminiGateway ??= createGeminiGateway();
  return geminiGlobal.__sapphireGeminiGateway;
}
