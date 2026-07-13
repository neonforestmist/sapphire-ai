import { readJsonBodyWithLimit } from "@/lib/security/limits";
import {
  assertJsonRequest,
  assertMutationOrigin,
  clientRateLimitKey,
  createRequestId,
  jsonData,
  jsonError,
} from "@/lib/server/http";
import { createSessionOwnership } from "@/lib/server/ownership";
import { getSapphireServerRuntime } from "@/lib/server/runtime";
import { createInterviewRequestSchema } from "@/lib/server/schemas";
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
      `create:${clientRateLimitKey(request)}`,
    );
    const body = await readJsonBodyWithLimit(
      request,
      createInterviewRequestSchema,
      32 * 1024,
    );
    const data = await new SapphireInterviewService(serverRuntime).createInterview(body);
    const ownership = createSessionOwnership(data.session.id, serverRuntime.environment);
    const response = jsonData({
      ...data,
      sessionId: data.session.id,
    }, { status: 201 });
    response.cookies.set(ownership.name, ownership.token, ownership.options);
    return response;
  } catch (error) {
    return jsonError(error, requestId, serverRuntime?.logger);
  }
}
