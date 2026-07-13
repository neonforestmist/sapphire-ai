import { describe, expect, it } from "vitest";

import {
  IllegalLiveConnectionTransitionError,
  initialLiveConnectionState,
  reduceLiveConnectionState,
  type LiveConnectionState,
} from "@/lib/live/state";

function connectedState(): LiveConnectionState {
  return reduceLiveConnectionState(
    reduceLiveConnectionState(initialLiveConnectionState, {
      type: "connect_requested",
    }),
    { type: "connected" },
  );
}

describe("Live connection state", () => {
  it("moves through connecting and connected states", () => {
    const connecting = reduceLiveConnectionState(initialLiveConnectionState, {
      type: "connect_requested",
    });
    const connected = reduceLiveConnectionState(connecting, { type: "connected" });

    expect(connecting.status).toBe("connecting");
    expect(connected.status).toBe("connected");
    expect(connected.lastError).toBeNull();
  });

  it("immediately clears active and queued playback on interruption", () => {
    let state = connectedState();
    state = reduceLiveConnectionState(state, {
      type: "playback_enqueued",
      playbackId: "audio-1",
    });
    state = reduceLiveConnectionState(state, {
      type: "playback_enqueued",
      playbackId: "audio-2",
    });
    state = reduceLiveConnectionState(state, {
      type: "playback_started",
      playbackId: "audio-1",
    });

    const interrupted = reduceLiveConnectionState(state, { type: "interrupted" });

    expect(interrupted.activePlaybackId).toBeNull();
    expect(interrupted.queuedPlaybackIds).toEqual([]);
    expect(interrupted.interruptionCount).toBe(1);
  });

  it("handles GoAway, retains a resumption handle, and reports recovery", () => {
    let state = connectedState();
    state = reduceLiveConnectionState(state, {
      type: "resumption_handle_updated",
      handle: "resume-1",
    });
    state = reduceLiveConnectionState(state, {
      type: "go_away_received",
      reconnectByMs: 10_000,
    });

    expect(state).toMatchObject({
      status: "reconnecting",
      goAwayDeadlineMs: 10_000,
      reconnectAttempt: 1,
      resumptionHandle: "resume-1",
    });

    state = reduceLiveConnectionState(state, {
      type: "recovered",
      resumptionHandle: "resume-2",
    });
    expect(state).toMatchObject({
      status: "recovered",
      goAwayDeadlineMs: null,
      resumptionHandle: "resume-2",
    });

    state = reduceLiveConnectionState(state, { type: "recovery_acknowledged" });
    expect(state.status).toBe("connected");
    expect(state.reconnectAttempt).toBe(0);
  });

  it("tracks context-compression signals without changing connection state", () => {
    const state = reduceLiveConnectionState(connectedState(), {
      type: "context_compressed",
      occurredAt: 12_345,
    });

    expect(state).toMatchObject({
      status: "connected",
      contextCompressionCount: 1,
      lastContextCompressionAt: 12_345,
    });
  });

  it("keeps the resumption handle across a disconnect and reconnect", () => {
    let state = connectedState();
    state = reduceLiveConnectionState(state, {
      type: "resumption_handle_updated",
      handle: "resume-1",
    });
    state = reduceLiveConnectionState(state, {
      type: "disconnected",
      error: { code: "NETWORK", message: "Connection lost.", retryable: true },
    });
    expect(state.status).toBe("disconnected");
    expect(state.resumptionHandle).toBe("resume-1");

    state = reduceLiveConnectionState(state, { type: "reconnect_requested" });
    expect(state.status).toBe("reconnecting");
    state = reduceLiveConnectionState(state, { type: "recovered" });
    expect(state.status).toBe("recovered");
    expect(state.resumptionHandle).toBe("resume-1");
  });

  it("clears playback and enters failed state on terminal failure", () => {
    let state = connectedState();
    state = reduceLiveConnectionState(state, {
      type: "playback_enqueued",
      playbackId: "audio-1",
    });
    const failed = reduceLiveConnectionState(state, {
      type: "failed",
      error: { code: "AUTH", message: "Live is unavailable.", retryable: false },
    });

    expect(failed.status).toBe("failed");
    expect(failed.queuedPlaybackIds).toEqual([]);
    expect(failed.lastError).toEqual({
      code: "AUTH",
      message: "Live is unavailable.",
      retryable: false,
    });
  });

  it("rejects illegal connection transitions", () => {
    expect(() =>
      reduceLiveConnectionState(initialLiveConnectionState, { type: "connected" }),
    ).toThrow(IllegalLiveConnectionTransitionError);
  });
});
