export type LiveConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "recovered"
  | "failed";

export type LiveConnectionError = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

export type LiveConnectionState = Readonly<{
  status: LiveConnectionStatus;
  queuedPlaybackIds: readonly string[];
  activePlaybackId: string | null;
  resumptionHandle: string | null;
  reconnectAttempt: number;
  goAwayDeadlineMs: number | null;
  interruptionCount: number;
  contextCompressionCount: number;
  lastContextCompressionAt: number | null;
  lastError: LiveConnectionError | null;
}>;

export const initialLiveConnectionState: LiveConnectionState = {
  status: "disconnected",
  queuedPlaybackIds: [],
  activePlaybackId: null,
  resumptionHandle: null,
  reconnectAttempt: 0,
  goAwayDeadlineMs: null,
  interruptionCount: 0,
  contextCompressionCount: 0,
  lastContextCompressionAt: null,
  lastError: null,
};

export type LiveConnectionAction =
  | Readonly<{ type: "connect_requested" }>
  | Readonly<{ type: "connected" }>
  | Readonly<{ type: "disconnected"; error?: LiveConnectionError }>
  | Readonly<{ type: "reconnect_requested" }>
  | Readonly<{ type: "recovered"; resumptionHandle?: string }>
  | Readonly<{ type: "recovery_acknowledged" }>
  | Readonly<{ type: "failed"; error: LiveConnectionError }>
  | Readonly<{ type: "playback_enqueued"; playbackId: string }>
  | Readonly<{ type: "playback_started"; playbackId: string }>
  | Readonly<{ type: "playback_completed"; playbackId: string }>
  | Readonly<{ type: "interrupted" }>
  | Readonly<{ type: "go_away_received"; reconnectByMs: number }>
  | Readonly<{ type: "resumption_handle_updated"; handle: string }>
  | Readonly<{ type: "context_compressed"; occurredAt: number }>;

export class IllegalLiveConnectionTransitionError extends Error {
  public constructor(status: LiveConnectionStatus, action: LiveConnectionAction["type"]) {
    super(`Illegal Live connection transition: ${status} + ${action}`);
    this.name = "IllegalLiveConnectionTransitionError";
  }
}

function assertNonEmptyId(value: string, label: string): void {
  if (!value.trim() || value.length > 256) {
    throw new RangeError(`${label} must be between 1 and 256 characters`);
  }
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function connectionOnly(
  state: LiveConnectionState,
  expected: readonly LiveConnectionStatus[],
  action: LiveConnectionAction["type"],
): void {
  if (!expected.includes(state.status)) {
    throw new IllegalLiveConnectionTransitionError(state.status, action);
  }
}

function clearPlayback(state: LiveConnectionState): Pick<
  LiveConnectionState,
  "queuedPlaybackIds" | "activePlaybackId"
> {
  return state.queuedPlaybackIds.length === 0 && state.activePlaybackId === null
    ? { queuedPlaybackIds: state.queuedPlaybackIds, activePlaybackId: null }
    : { queuedPlaybackIds: [], activePlaybackId: null };
}

/** Pure reducer; audio bytes and transport objects deliberately stay outside state. */
export function reduceLiveConnectionState(
  state: LiveConnectionState,
  action: LiveConnectionAction,
): LiveConnectionState {
  switch (action.type) {
    case "connect_requested":
      connectionOnly(state, ["disconnected", "failed"], action.type);
      return {
        ...state,
        status: "connecting",
        reconnectAttempt: 0,
        goAwayDeadlineMs: null,
        lastError: null,
      };
    case "connected":
      connectionOnly(state, ["connecting"], action.type);
      return {
        ...state,
        status: "connected",
        reconnectAttempt: 0,
        goAwayDeadlineMs: null,
        lastError: null,
      };
    case "disconnected":
      connectionOnly(
        state,
        ["connecting", "connected", "reconnecting", "recovered"],
        action.type,
      );
      return {
        ...state,
        ...clearPlayback(state),
        status: "disconnected",
        goAwayDeadlineMs: null,
        lastError: action.error ?? null,
      };
    case "reconnect_requested":
      connectionOnly(state, ["disconnected", "connected", "recovered"], action.type);
      return {
        ...state,
        status: "reconnecting",
        reconnectAttempt: state.reconnectAttempt + 1,
        lastError: null,
      };
    case "recovered":
      connectionOnly(state, ["reconnecting"], action.type);
      if (action.resumptionHandle !== undefined) {
        assertNonEmptyId(action.resumptionHandle, "resumptionHandle");
      }
      return {
        ...state,
        status: "recovered",
        resumptionHandle: action.resumptionHandle ?? state.resumptionHandle,
        goAwayDeadlineMs: null,
        lastError: null,
      };
    case "recovery_acknowledged":
      connectionOnly(state, ["recovered"], action.type);
      return { ...state, status: "connected", reconnectAttempt: 0 };
    case "failed":
      return {
        ...state,
        ...clearPlayback(state),
        status: "failed",
        goAwayDeadlineMs: null,
        lastError: action.error,
      };
    case "playback_enqueued":
      connectionOnly(state, ["connected", "recovered"], action.type);
      assertNonEmptyId(action.playbackId, "playbackId");
      if (
        state.activePlaybackId === action.playbackId ||
        state.queuedPlaybackIds.includes(action.playbackId)
      ) {
        return state;
      }
      return {
        ...state,
        queuedPlaybackIds: [...state.queuedPlaybackIds, action.playbackId],
      };
    case "playback_started": {
      connectionOnly(state, ["connected", "recovered"], action.type);
      assertNonEmptyId(action.playbackId, "playbackId");
      if (state.activePlaybackId !== null) {
        throw new Error("A Live playback item is already active");
      }
      const queueIndex = state.queuedPlaybackIds.indexOf(action.playbackId);
      if (queueIndex < 0) {
        throw new Error("Playback must be queued before it can start");
      }
      return {
        ...state,
        activePlaybackId: action.playbackId,
        queuedPlaybackIds: state.queuedPlaybackIds.filter(
          (_id, index) => index !== queueIndex,
        ),
      };
    }
    case "playback_completed":
      connectionOnly(state, ["connected", "recovered"], action.type);
      if (state.activePlaybackId !== action.playbackId) {
        throw new Error("Only the active Live playback item can complete");
      }
      return { ...state, activePlaybackId: null };
    case "interrupted":
      connectionOnly(state, ["connected", "recovered", "reconnecting"], action.type);
      return {
        ...state,
        ...clearPlayback(state),
        interruptionCount: state.interruptionCount + 1,
      };
    case "go_away_received":
      connectionOnly(state, ["connected", "recovered"], action.type);
      assertTimestamp(action.reconnectByMs, "reconnectByMs");
      return {
        ...state,
        status: "reconnecting",
        reconnectAttempt: state.reconnectAttempt + 1,
        goAwayDeadlineMs: action.reconnectByMs,
      };
    case "resumption_handle_updated":
      connectionOnly(
        state,
        ["connected", "disconnected", "reconnecting", "recovered"],
        action.type,
      );
      assertNonEmptyId(action.handle, "resumptionHandle");
      return { ...state, resumptionHandle: action.handle };
    case "context_compressed":
      connectionOnly(state, ["connected", "recovered", "reconnecting"], action.type);
      assertTimestamp(action.occurredAt, "occurredAt");
      return {
        ...state,
        contextCompressionCount: state.contextCompressionCount + 1,
        lastContextCompressionAt: action.occurredAt,
      };
  }
}
