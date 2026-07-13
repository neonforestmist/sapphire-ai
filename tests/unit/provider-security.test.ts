import { describe, expect, it } from "vitest";

import {
  issueOwnershipCapability,
  verifyOwnershipCapability,
} from "@/lib/security/capability";
import {
  EnvironmentConfigurationError,
  parseServerEnvironment,
} from "@/lib/security/env";
import { InMemoryRateLimiter, KeyedConcurrencyGuard } from "@/lib/security/limits";

const secret = "s".repeat(32);

describe("server environment", () => {
  it("selects credential-free mock mode locally without rejecting unrelated variables", () => {
    const environment = parseServerEnvironment({
      NODE_ENV: "development",
      AN_UNRELATED_PLATFORM_VARIABLE: "allowed",
    });

    expect(environment.geminiMode).toBe("mock");
    expect(environment.geminiReasoningModel).toBe("gemini-3.5-flash");
    expect(environment.enableFirestore).toBe(false);
  });

  it("does not silently select mock mode in production", () => {
    expect(() => parseServerEnvironment({ NODE_ENV: "production" })).toThrow(
      EnvironmentConfigurationError,
    );
  });

  it("requires durable snapshot metadata when Cloud Storage is enabled", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "test",
        ENABLE_CLOUD_STORAGE: "true",
        ENABLE_FIRESTORE: "false",
        GOOGLE_CLOUD_PROJECT: "project",
        GCS_BUCKET: "bucket",
      }),
    ).toThrow(/ENABLE_FIRESTORE=true/);
  });
});

describe("anonymous ownership capabilities", () => {
  it("binds a signed capability to one session and expiry", () => {
    const issued = issueOwnershipCapability({
      sessionId: "session-1",
      secret,
      ttlSeconds: 300,
      now: new Date(1_000_000),
      nonce: "deterministic-nonce",
    });

    expect(
      verifyOwnershipCapability({
        token: issued.token,
        secret,
        expectedSessionId: "session-1",
        now: new Date(1_001_000),
      }).sessionId,
    ).toBe("session-1");
    expect(() =>
      verifyOwnershipCapability({
        token: issued.token,
        secret,
        expectedSessionId: "session-2",
        now: new Date(1_001_000),
      }),
    ).toThrow(/ownership could not be verified/i);
    expect(() =>
      verifyOwnershipCapability({
        token: issued.token,
        secret,
        now: new Date(1_400_000),
      }),
    ).toThrow(/expired/i);
  });

  it("rejects a tampered signature", () => {
    const issued = issueOwnershipCapability({
      sessionId: "session-1",
      secret,
      ttlSeconds: 300,
    });
    const tampered = `${issued.token.slice(0, -1)}${issued.token.endsWith("a") ? "b" : "a"}`;
    expect(() => verifyOwnershipCapability({ token: tampered, secret })).toThrow(
      /ownership could not be verified/i,
    );
  });
});

describe("process-local abuse controls", () => {
  it("enforces a bounded rate window", () => {
    const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 1_000 });
    expect(limiter.check("session", 0).allowed).toBe(true);
    expect(limiter.check("session", 1).allowed).toBe(true);
    expect(limiter.check("session", 2).allowed).toBe(false);
    expect(limiter.check("session", 1_001).allowed).toBe(true);
  });

  it("rejects concurrent work for the same session and releases the key", async () => {
    const guard = new KeyedConcurrencyGuard();
    let release!: () => void;
    const pending = guard.run(
      "session",
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    await expect(guard.run("session", async () => undefined)).rejects.toMatchObject({
      code: "ANALYSIS_IN_PROGRESS",
    });
    release();
    await pending;
    await expect(guard.run("session", async () => "done")).resolves.toBe("done");
  });
});
