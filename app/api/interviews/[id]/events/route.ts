import { readJsonBodyWithLimit } from "@/lib/security/limits";
import {
  assertJsonRequest,
  assertMutationOrigin,
  clientRateLimitKey,
  createRequestId,
  jsonData,
  jsonError,
  parseDomainId,
} from "@/lib/server/http";
import { verifySessionOwnership } from "@/lib/server/ownership";
import { getSapphireServerRuntime } from "@/lib/server/runtime";
import { appendTranscriptEventRequestSchema } from "@/lib/server/schemas";
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
    assertJsonRequest(request);
    const sessionId = parseDomainId((await context.params).id, "session");
    serverRuntime.requestRateLimiter.assertAllowed(
      `event:${clientRateLimitKey(request)}`,
    );
    verifySessionOwnership(request, sessionId, serverRuntime.environment);
    const body = await readJsonBodyWithLimit(
      request,
      appendTranscriptEventRequestSchema,
      64 * 1024,
    );
    return jsonData(
      await new SapphireInterviewService(serverRuntime).appendTranscript(sessionId, body),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error, requestId, serverRuntime?.logger);
  }
}
