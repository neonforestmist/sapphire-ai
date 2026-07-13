import { describe, expect, it, vi } from "vitest";

import {
  LiveToolApplicationError,
  createLiveToolDispatcher,
  type LiveToolHandlers,
} from "@/lib/live/dispatcher";
import {
  advanceInterviewStageArgsSchema,
  focusBoardElementsArgsSchema,
  liveToolNameSchema,
  recordInterviewSignalArgsSchema,
} from "@/lib/live/schemas";
import {
  transitionInterviewSession,
} from "@/lib/interview/state-machine";
import type { InterviewSession } from "@/lib/interview/schemas";

function handlers(
  overrides: Partial<LiveToolHandlers> = {},
): LiveToolHandlers {
  return {
    request_board_analysis: vi.fn(async () => ({ requested: true })),
    focus_board_elements: vi.fn(async ({ elementIds }) => ({ elementIds })),
    record_interview_signal: vi.fn(async () => ({ recorded: true })),
    advance_interview_stage: vi.fn(async ({ nextStage }) => ({ nextStage })),
    inject_constraint: vi.fn(async ({ constraintId }) => ({ constraintId })),
    request_candidate_reflection: vi.fn(async ({ topic }) => ({ topic })),
    finish_interview: vi.fn(async () => ({ accepted: true })),
    ...overrides,
  };
}

describe("Live tool schemas", () => {
  it("defines exactly the seven allowed tool names", () => {
    expect(liveToolNameSchema.options).toEqual([
      "request_board_analysis",
      "focus_board_elements",
      "record_interview_signal",
      "advance_interview_stage",
      "inject_constraint",
      "request_candidate_reflection",
      "finish_interview",
    ]);
  });

  it("uses strict arguments, stable IDs, stages, and competency names", () => {
    expect(
      focusBoardElementsArgsSchema.safeParse({
        elementIds: ["us-store"],
        message: "Compare this store.",
        untrustedExtra: true,
      }).success,
    ).toBe(false);
    expect(
      focusBoardElementsArgsSchema.safeParse({
        elementIds: ["bad id"],
        message: "Compare this store.",
      }).success,
    ).toBe(false);
    expect(
      advanceInterviewStageArgsSchema.safeParse({
        nextStage: "NOT_A_STAGE",
        reason: "Move on.",
      }).success,
    ).toBe(false);
    expect(
      recordInterviewSignalArgsSchema.safeParse({
        competency: "mind_reading",
        signal: "Invented evidence.",
        evidenceRefs: ["evidence-1"],
      }).success,
    ).toBe(false);
  });
});

describe("Live tool dispatcher", () => {
  it("dispatches validated arguments to the matching application hook", async () => {
    const requestBoardAnalysis = vi.fn(async (args) => ({
      accepted: true,
      reason: args.reason,
    }));
    const dispatcher = createLiveToolDispatcher({
      handlers: handlers({ request_board_analysis: requestBoardAnalysis }),
      getKnownBoardElementIds: () => ["us-store", "eu-store"],
    });

    const response = await dispatcher.dispatch({
      call: {
        id: "call-1",
        name: "request_board_analysis",
        args: { reason: "The candidate paused.", urgency: "next_pause" },
      },
    });

    expect(response).toEqual({
      id: "call-1",
      name: "request_board_analysis",
      response: {
        ok: true,
        result: { accepted: true, reason: "The candidate paused." },
      },
    });
    expect(requestBoardAnalysis).toHaveBeenCalledWith(
      { reason: "The candidate paused.", urgency: "next_pause" },
      expect.objectContaining({
        callId: "call-1",
        toolName: "request_board_analysis",
      }),
    );
  });

  it("rejects unknown tools and invalid arguments without invoking a handler", async () => {
    const requestBoardAnalysis = vi.fn(async () => ({ accepted: true }));
    const dispatcher = createLiveToolDispatcher({
      handlers: handlers({ request_board_analysis: requestBoardAnalysis }),
      getKnownBoardElementIds: () => [],
    });

    const unknown = await dispatcher.dispatch({
      call: { id: "call-2", name: "delete_session", args: {} },
    });
    const invalid = await dispatcher.dispatch({
      call: {
        id: "call-3",
        name: "request_board_analysis",
        args: { reason: "Analyze", urgency: "whenever", extra: true },
      },
    });

    expect(unknown.response).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_TOOL" },
    });
    expect(invalid.response).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENTS" },
    });
    expect(requestBoardAnalysis).not.toHaveBeenCalled();
  });

  it("rejects unknown board IDs before focus reaches application code", async () => {
    const focusBoardElements = vi.fn(async () => ({ focused: true }));
    const dispatcher = createLiveToolDispatcher({
      handlers: handlers({ focus_board_elements: focusBoardElements }),
      getKnownBoardElementIds: () => ["us-store", "eu-store"],
    });

    const response = await dispatcher.dispatch({
      call: {
        id: "call-4",
        name: "focus_board_elements",
        args: {
          elementIds: ["us-store", "invented-store"],
          message: "Inspect these quota stores.",
        },
      },
    });

    expect(response.response).toMatchObject({
      ok: false,
      error: {
        code: "UNKNOWN_BOARD_ELEMENT_IDS",
        details: { unknownElementIds: ["invented-store"] },
      },
    });
    expect(focusBoardElements).not.toHaveBeenCalled();
  });

  it("hands stage recommendations to the legal application transition hook", async () => {
    let session: InterviewSession = {
      id: "session-1",
      scenarioId: "rate-limiter",
      mode: "demo",
      stage: "INITIAL_DECOMPOSITION",
      status: "active",
      createdAt: 10,
      updatedAt: 10,
      latestAnalysisVersion: 0,
    };
    const advanceStage = vi.fn(async ({ nextStage }) => {
      session = transitionInterviewSession(session, nextStage, 20);
      return { stage: session.stage, status: session.status };
    });
    const dispatcher = createLiveToolDispatcher({
      handlers: handlers({ advance_interview_stage: advanceStage }),
      getKnownBoardElementIds: () => [],
    });

    const response = await dispatcher.dispatch({
      call: {
        id: "call-5",
        name: "advance_interview_stage",
        args: {
          nextStage: "SOLUTION_CONSTRUCTION",
          reason: "The candidate completed the initial decomposition.",
        },
      },
    });

    expect(response.response).toEqual({
      ok: true,
      result: { stage: "SOLUTION_CONSTRUCTION", status: "active" },
    });
    expect(session.stage).toBe("SOLUTION_CONSTRUCTION");
    expect(advanceStage).toHaveBeenCalledOnce();
  });

  it("sanitizes handler results and never exposes unexpected exception text", async () => {
    const safeDispatcher = createLiveToolDispatcher({
      handlers: handlers({
        finish_interview: async () => ({
          accepted: true,
          ephemeralToken: "must-not-leak",
          nested: { api_key: "also-secret" },
        }),
      }),
      getKnownBoardElementIds: () => [],
    });
    const failedDispatcher = createLiveToolDispatcher({
      handlers: handlers({
        finish_interview: async () => {
          throw new Error("database password is swordfish");
        },
      }),
      getKnownBoardElementIds: () => [],
    });

    const call = {
      id: "call-6",
      name: "finish_interview",
      args: { reason: "Time is complete." },
    };
    const safe = await safeDispatcher.dispatch({ call });
    const failed = await failedDispatcher.dispatch({ call });

    expect(safe.response).toEqual({
      ok: true,
      result: {
        accepted: true,
        ephemeralToken: "[redacted]",
        nested: { api_key: "[redacted]" },
      },
    });
    expect(JSON.stringify(failed)).not.toContain("swordfish");
    expect(failed.response).toMatchObject({
      ok: false,
      error: { code: "HANDLER_FAILED", retryable: true },
    });
  });

  it("returns an application-safe rejection message for an expected denial", async () => {
    const dispatcher = createLiveToolDispatcher({
      handlers: handlers({
        inject_constraint: async () => {
          throw new LiveToolApplicationError({
            publicMessage: "That scenario constraint is not available.",
          });
        },
      }),
      getKnownBoardElementIds: () => [],
    });

    const response = await dispatcher.dispatch({
      call: {
        id: "call-7",
        name: "inject_constraint",
        args: { constraintId: "unknown-constraint" },
      },
    });

    expect(response.response).toEqual({
      ok: false,
      error: {
        code: "APPLICATION_REJECTED",
        message: "That scenario constraint is not available.",
        retryable: false,
      },
    });
  });
});
