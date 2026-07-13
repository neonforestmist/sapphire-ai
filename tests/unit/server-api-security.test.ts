import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "@/lib/security/env";
import {
  createSessionOwnership,
  verifySessionOwnership,
} from "@/lib/server/ownership";
import {
  analyzeBoardRequestSchema,
  createInterviewRequestSchema,
} from "@/lib/server/schemas";
import { RATE_LIMITER_INITIAL_SCENE } from "@/lib/whiteboard/rate-limiter-fixture";

const environment = parseServerEnvironment({
  NODE_ENV: "test",
  GEMINI_MODE: "mock",
  ENABLE_GEMINI_LIVE: "false",
  ENABLE_FIRESTORE: "false",
  ENABLE_CLOUD_STORAGE: "false",
  SESSION_SIGNING_SECRET: "test-only-session-signing-secret-with-32-bytes",
});

describe("server API request and ownership boundaries", () => {
  it("requires consent consistent with the chosen input mode", () => {
    expect(
      createInterviewRequestSchema.safeParse({
        scenarioId: "global-rate-limiter",
        inputMode: "voice",
        consent: { transcript: true, microphone: false },
      }).success,
    ).toBe(false);
    expect(
      createInterviewRequestSchema.parse({
        scenarioId: "global-rate-limiter",
        inputMode: "text",
        consent: { transcript: true, microphone: false },
      }).mode,
    ).toBe("demo");
  });

  it("strictly validates analysis input while allowing the server to derive a diff", () => {
    expect(
      analyzeBoardRequestSchema.parse({
        scene: RATE_LIMITER_INITIAL_SCENE,
        boardImage: null,
      }).triggerReason,
    ).toMatch(/requested board analysis/i);
    expect(
      analyzeBoardRequestSchema.safeParse({
        scene: RATE_LIMITER_INITIAL_SCENE,
        boardImage: null,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("accepts only the signed cookie scoped to the expected session", () => {
    const ownership = createSessionOwnership("session-one", environment);
    const ownedRequest = new Request("http://localhost/api/interviews/session-one", {
      headers: { cookie: `${ownership.name}=${encodeURIComponent(ownership.token)}` },
    });
    expect(() =>
      verifySessionOwnership(ownedRequest, "session-one", environment),
    ).not.toThrow();
    expect(() =>
      verifySessionOwnership(ownedRequest, "session-two", environment),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CAPABILITY", status: 401 }));
    expect(() =>
      verifySessionOwnership(
        new Request("http://localhost/api/interviews/session-one"),
        "session-one",
        environment,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CAPABILITY", status: 401 }));
  });
});
