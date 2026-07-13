import {
  assertJsonRequest,
  assertMutationOrigin,
  clientRateLimitKey,
  createRequestId,
  jsonData,
  jsonError,
  parseDomainId,
} from "@/lib/server/http";
import { readJsonBodyWithLimit } from "@/lib/security/limits";
import { verifySessionOwnership } from "@/lib/server/ownership";
import { getSapphireServerRuntime } from "@/lib/server/runtime";
import { finishInterviewRequestSchema } from "@/lib/server/schemas";
import { SapphireInterviewService } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  let serverRuntime: ReturnType<typeof getSapphireServerRuntime> | undefined;
  try {
    serverRuntime = getSapphireServerRuntime();
    assertMutationOrigin(request);
    const sessionId = parseDomainId((await context.params).id, "session");
    serverRuntime.requestRateLimiter.assertAllowed(
      `finish:${clientRateLimitKey(request)}`,
    );
    verifySessionOwnership(request, sessionId, serverRuntime.environment);
    let reason = "Candidate ended the interview.";
    if (request.body !== null) {
      assertJsonRequest(request);
      const body = await readJsonBodyWithLimit(
        request,
        finishInterviewRequestSchema,
        4 * 1024,
      );
      reason = body.reason;
    }
    return jsonData(
      await new SapphireInterviewService(serverRuntime).finishInterview(sessionId, reason),
    );
  } catch (error) {
    return jsonError(error, requestId, serverRuntime?.logger);
  }
}
