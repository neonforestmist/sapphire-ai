import { createRequestId, jsonData, jsonError } from "@/lib/server/http";
import { getSapphireServerRuntime } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = createRequestId();
  let serverRuntime: ReturnType<typeof getSapphireServerRuntime> | undefined;
  try {
    serverRuntime = getSapphireServerRuntime();
    return jsonData({
      status: "ok",
      providerMode: serverRuntime.gemini.mode,
      persistenceMode: serverRuntime.persistence.mode,
      liveEnabled: serverRuntime.environment.enableGeminiLive,
    });
  } catch (error) {
    return jsonError(error, requestId, serverRuntime?.logger);
  }
}
