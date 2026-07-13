import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { AppError } from "./errors";
import { assertServerRuntime } from "./server-only";

const TOKEN_VERSION = "v1";
const MAX_TOKEN_LENGTH = 4_096;
const CLOCK_SKEW_SECONDS = 30;

const OwnershipCapabilityPayloadSchema = z.object({
  version: z.literal(1),
  purpose: z.literal("session-owner"),
  sessionId: z.string().min(1).max(256),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  nonce: z.string().min(16).max(128),
}).strict();

export type OwnershipCapabilityPayload = z.infer<typeof OwnershipCapabilityPayloadSchema>;

export class OwnershipCapabilityError extends AppError {
  constructor(code: "INVALID_CAPABILITY" | "EXPIRED_CAPABILITY", message: string) {
    super({ code, message, status: 401, expose: true });
    this.name = "OwnershipCapabilityError";
  }
}

function assertStrongSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new AppError({
      code: "WEAK_SESSION_SECRET",
      message: "The session-signing secret must be at least 32 bytes.",
      status: 500,
      expose: false,
    });
  }
}

function signatureFor(unsignedToken: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(unsignedToken, "utf8").digest();
}

export function issueOwnershipCapability(options: {
  sessionId: string;
  secret: string;
  ttlSeconds: number;
  now?: Date;
  nonce?: string;
}): { token: string; payload: OwnershipCapabilityPayload } {
  assertServerRuntime();
  assertStrongSecret(options.secret);
  if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds < 60 || options.ttlSeconds > 86_400) {
    throw new AppError({
      code: "INVALID_CAPABILITY_TTL",
      message: "Session capability TTL must be between 60 and 86400 seconds.",
      status: 500,
      expose: false,
    });
  }

  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const payload = OwnershipCapabilityPayloadSchema.parse({
    version: 1,
    purpose: "session-owner",
    sessionId: options.sessionId,
    issuedAt,
    expiresAt: issuedAt + options.ttlSeconds,
    nonce: options.nonce ?? randomBytes(18).toString("base64url"),
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const unsignedToken = `${TOKEN_VERSION}.${encodedPayload}`;
  const signature = signatureFor(unsignedToken, options.secret).toString("base64url");

  return { token: `${unsignedToken}.${signature}`, payload };
}

export function verifyOwnershipCapability(options: {
  token: string;
  secret: string;
  expectedSessionId?: string;
  now?: Date;
}): OwnershipCapabilityPayload {
  assertServerRuntime();
  assertStrongSecret(options.secret);
  if (!options.token || options.token.length > MAX_TOKEN_LENGTH) {
    throw new OwnershipCapabilityError("INVALID_CAPABILITY", "Session ownership could not be verified.");
  }

  const [version, encodedPayload, encodedSignature, ...extra] = options.token.split(".");
  if (version !== TOKEN_VERSION || !encodedPayload || !encodedSignature || extra.length > 0) {
    throw new OwnershipCapabilityError("INVALID_CAPABILITY", "Session ownership could not be verified.");
  }

  const unsignedToken = `${version}.${encodedPayload}`;
  const expectedSignature = signatureFor(unsignedToken, options.secret);
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw new OwnershipCapabilityError("INVALID_CAPABILITY", "Session ownership could not be verified.");
  }

  // Node's base64url decoder accepts non-canonical trailing bits. Re-encoding
  // prevents a different token string from decoding to the same signature.
  if (suppliedSignature.toString("base64url") !== encodedSignature) {
    throw new OwnershipCapabilityError("INVALID_CAPABILITY", "Session ownership could not be verified.");
  }

  if (
    suppliedSignature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new OwnershipCapabilityError("INVALID_CAPABILITY", "Session ownership could not be verified.");
  }

  let payload: OwnershipCapabilityPayload;
  try {
    const payloadBytes = Buffer.from(encodedPayload, "base64url");
    if (payloadBytes.toString("base64url") !== encodedPayload) {
      throw new Error("Non-canonical payload encoding");
    }
    payload = OwnershipCapabilityPayloadSchema.parse(
      JSON.parse(payloadBytes.toString("utf8")),
    );
  } catch {
    throw new OwnershipCapabilityError("INVALID_CAPABILITY", "Session ownership could not be verified.");
  }

  const now = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  if (payload.issuedAt > now + CLOCK_SKEW_SECONDS) {
    throw new OwnershipCapabilityError("INVALID_CAPABILITY", "Session ownership could not be verified.");
  }
  if (payload.expiresAt <= now) {
    throw new OwnershipCapabilityError("EXPIRED_CAPABILITY", "This session access has expired.");
  }
  if (payload.expiresAt <= payload.issuedAt) {
    throw new OwnershipCapabilityError("INVALID_CAPABILITY", "Session ownership could not be verified.");
  }
  if (options.expectedSessionId && payload.sessionId !== options.expectedSessionId) {
    throw new OwnershipCapabilityError("INVALID_CAPABILITY", "Session ownership could not be verified.");
  }

  return payload;
}

export function ownershipCookieOptions(expiresAt: number): {
  httpOnly: true;
  sameSite: "strict";
  secure: boolean;
  path: string;
  expires: Date;
} {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt * 1_000),
  };
}
