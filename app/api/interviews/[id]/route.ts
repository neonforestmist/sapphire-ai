import {
  assertMutationOrigin,
  clientRateLimitKey,
  createRequestId,
  jsonData,
  jsonError,
  parseDomainId,
} from "@/lib/server/http";
import {
  sessionOwnershipCookieName,
  verifySessionOwnership,
} from "@/lib/server/ownership";
import { getSapphireServerRuntime } from "@/lib/server/runtime";
import { SapphireInterviewService } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  let serverRuntime: ReturnType<typeof getSapphireServerRuntime> | undefined;
  try {
    serverRuntime = getSapphireServerRuntime();
    const sessionId = parseDomainId((await context.params).id, "session");
    serverRuntime.requestRateLimiter.assertAllowed(
      `read:${clientRateLimitKey(request)}`,
    );
    verifySessionOwnership(request, sessionId, serverRuntime.environment);
    return jsonData(await new SapphireInterviewService(serverRuntime).getInterview(sessionId));
  } catch (error) {
    return jsonError(error, requestId, serverRuntime?.logger);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  let serverRuntime: ReturnType<typeof getSapphireServerRuntime> | undefined;
  try {
    serverRuntime = getSapphireServerRuntime();
    assertMutationOrigin(request);
    const sessionId = parseDomainId((await context.params).id, "session");
    serverRuntime.requestRateLimiter.assertAllowed(
      `delete:${clientRateLimitKey(request)}`,
    );
    verifySessionOwnership(request, sessionId, serverRuntime.environment);
    const response = jsonData(
      await new SapphireInterviewService(serverRuntime).deleteInterview(sessionId),
    );
    response.cookies.set(sessionOwnershipCookieName(sessionId), "", {
      httpOnly: true,
      sameSite: "strict",
      secure: serverRuntime.environment.nodeEnv === "production",
      path: "/",
      expires: new Date(0),
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return jsonError(error, requestId, serverRuntime?.logger);
  }
}
