import { readJsonBodyWithLimit } from "@/lib/security/limits";
import {
  assertJsonRequest,
  assertMutationOrigin,
  clientRateLimitKey,
  createRequestId,
  jsonData,
  jsonError,
} from "@/lib/server/http";
import { verifySessionOwnership } from "@/lib/server/ownership";
import { getSapphireServerRuntime } from "@/lib/server/runtime";
import { liveTokenRequestSchema } from "@/lib/server/schemas";
import { SapphireInterviewService } from "@/lib/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = createRequestId();
  let serverRuntime: ReturnType<typeof getSapphireServerRuntime> | undefined;
  try {
    serverRuntime = getSapphireServerRuntime();
    assertMutationOrigin(request);
    assertJsonRequest(request);
    serverRuntime.requestRateLimiter.assertAllowed(
      `live:${clientRateLimitKey(request)}`,
    );
    const body = await readJsonBodyWithLimit(request, liveTokenRequestSchema, 16 * 1024);
    verifySessionOwnership(request, body.sessionId, serverRuntime.environment);
    return jsonData(
      await new SapphireInterviewService(serverRuntime).createLiveToken(body.sessionId),
    );
  } catch (error) {
    return jsonError(error, requestId, serverRuntime?.logger);
  }
}
