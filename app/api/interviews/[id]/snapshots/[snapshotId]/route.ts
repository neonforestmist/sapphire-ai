import {
  clientRateLimitKey,
  createRequestId,
  jsonError,
  parseDomainId,
} from "@/lib/server/http";
import { verifySessionOwnership } from "@/lib/server/ownership";
import { getSapphireServerRuntime } from "@/lib/server/runtime";
import { AppError } from "@/lib/security/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; snapshotId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  let serverRuntime: ReturnType<typeof getSapphireServerRuntime> | undefined;
  try {
    serverRuntime = getSapphireServerRuntime();
    const params = await context.params;
    const sessionId = parseDomainId(params.id, "session");
    const snapshotId = parseDomainId(params.snapshotId, "snapshot");
    serverRuntime.requestRateLimiter.assertAllowed(
      `snapshot:${clientRateLimitKey(request)}`,
    );
    verifySessionOwnership(request, sessionId, serverRuntime.environment);
    const image = await serverRuntime.persistence.snapshots.getImage(sessionId, snapshotId);
    if (!image) {
      throw new AppError({
        code: "SNAPSHOT_IMAGE_NOT_FOUND",
        message: "The snapshot image was not found.",
        status: 404,
        expose: true,
      });
    }
    const responseBytes = Uint8Array.from(image.data);
    return new Response(responseBytes.buffer, {
      status: 200,
      headers: {
        "content-type": image.mimeType,
        "content-length": String(image.data.byteLength),
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error, requestId, serverRuntime?.logger);
  }
}
