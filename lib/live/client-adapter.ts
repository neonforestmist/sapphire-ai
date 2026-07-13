import type { LiveToolResponse } from "./dispatcher";

export type LiveClientConnection = Readonly<{
  /** Short-lived, one-use token minted by the SapphireAI backend. */
  ephemeralToken: string;
  model: string;
  resumptionHandle?: string;
  signal?: AbortSignal;
}>;

export type LiveClientEvent =
  | Readonly<{ type: "input_transcript_final"; text: string }>
  | Readonly<{ type: "output_transcript_final"; text: string }>
  | Readonly<{ type: "interrupted" }>
  | Readonly<{ type: "go_away"; reconnectByMs: number }>
  | Readonly<{ type: "resumption_handle"; handle: string }>
  | Readonly<{ type: "context_compressed"; occurredAt: number }>
  | Readonly<{ type: "closed"; retryable: boolean }>
  | Readonly<{ type: "error"; code: string; retryable: boolean }>;

/**
 * Browser-facing boundary for a future Live transport. It deliberately has no
 * long-lived API-key field and no concrete WebSocket implementation yet.
 */
export interface LiveClientAdapter {
  connect(connection: LiveClientConnection): Promise<void>;
  disconnect(): Promise<void>;
  sendPcm16Audio(chunk: Int16Array): void;
  sendText(text: string): Promise<void>;
  sendToolResponse(response: LiveToolResponse): Promise<void>;
  subscribe(listener: (event: LiveClientEvent) => void): () => void;
}
