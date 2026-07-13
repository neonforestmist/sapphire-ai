import {
  issueOwnershipCapability,
  ownershipCookieOptions,
  verifyOwnershipCapability,
} from "@/lib/security/capability";
import {
  resolveSessionSigningSecret,
  type ServerEnvironment,
} from "@/lib/security/env";
import { OwnershipCapabilityError } from "@/lib/security/capability";

const COOKIE_PREFIX = "sapphire_session_owner_";

export function sessionOwnershipCookieName(sessionId: string): string {
  return `${COOKIE_PREFIX}${sessionId}`;
}

function parseCookieHeader(header: string | null): Map<string, string> {
  const values = new Map<string, string>();
  for (const pair of header?.split(";") ?? []) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const rawValue = pair.slice(separator + 1).trim();
    try {
      values.set(name, decodeURIComponent(rawValue));
    } catch {
      values.set(name, rawValue);
    }
  }
  return values;
}

export function createSessionOwnership(
  sessionId: string,
  environment: ServerEnvironment,
): {
  name: string;
  token: string;
  options: ReturnType<typeof ownershipCookieOptions>;
} {
  const capability = issueOwnershipCapability({
    sessionId,
    secret: resolveSessionSigningSecret(environment),
    ttlSeconds: environment.sessionCapabilityTtlSeconds,
  });
  return {
    name: sessionOwnershipCookieName(sessionId),
    token: capability.token,
    options: ownershipCookieOptions(capability.payload.expiresAt),
  };
}

export function verifySessionOwnership(
  request: Pick<Request, "headers">,
  sessionId: string,
  environment: ServerEnvironment,
): void {
  const token = parseCookieHeader(request.headers.get("cookie")).get(
    sessionOwnershipCookieName(sessionId),
  );
  if (!token) {
    throw new OwnershipCapabilityError(
      "INVALID_CAPABILITY",
      "Session ownership could not be verified.",
    );
  }
  verifyOwnershipCapability({
    token,
    secret: resolveSessionSigningSecret(environment),
    expectedSessionId: sessionId,
  });
}
