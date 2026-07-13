import {
  clientRateLimitKey,
  createRequestId,
  jsonData,
  jsonError,
  parseDomainId,
} from "@/lib/server/http";
import { verifySessionOwnership } from "@/lib/server/ownership";
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
      `report:${clientRateLimitKey(request)}`,
    );
    verifySessionOwnership(request, sessionId, serverRuntime.environment);
    return jsonData(await new SapphireInterviewService(serverRuntime).getReport(sessionId));
  } catch (error) {
    return jsonError(error, requestId, serverRuntime?.logger);
  }
}
