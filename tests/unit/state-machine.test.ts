import { describe, expect, it } from "vitest";

import {
  LEGAL_INTERVIEW_TRANSITIONS,
  getNextInterviewStage,
  IllegalInterviewStageTransitionError,
  isLegalInterviewStageTransition,
  transitionInterviewSession,
} from "@/lib/interview/state-machine";
import type { InterviewSession, InterviewStage } from "@/lib/interview/schemas";

const session: InterviewSession = {
  id: "session-state-machine",
  scenarioId: "global-rate-limiter",
  mode: "demo",
  stage: "SETUP",
  status: "active",
  createdAt: 100,
  updatedAt: 100,
  latestAnalysisVersion: 0,
};

describe("interview state machine", () => {
  it("defines the complete legal stage path", () => {
    const visited: InterviewStage[] = ["SETUP"];
    let stage: InterviewStage = "SETUP";

    while (getNextInterviewStage(stage) !== null) {
      stage = getNextInterviewStage(stage)!;
      visited.push(stage);
    }

    expect(visited).toEqual([
      "SETUP",
      "BRIEFING",
      "REQUIREMENT_CLARIFICATION",
      "INITIAL_DECOMPOSITION",
      "SOLUTION_CONSTRUCTION",
      "CONSTRAINT_INJECTION",
      "TRADEOFF_CHALLENGE",
      "REFLECTION",
      "GENERATING_REPORT",
      "COMPLETE",
    ]);
    expect(LEGAL_INTERVIEW_TRANSITIONS.COMPLETE).toEqual([]);
  });

  it("accepts adjacent transitions and rejects skips, regressions, and self-transitions", () => {
    expect(isLegalInterviewStageTransition("SETUP", "BRIEFING")).toBe(true);
    expect(isLegalInterviewStageTransition("SETUP", "SOLUTION_CONSTRUCTION")).toBe(false);
    expect(isLegalInterviewStageTransition("BRIEFING", "SETUP")).toBe(false);
    expect(isLegalInterviewStageTransition("BRIEFING", "BRIEFING")).toBe(false);
  });

  it("updates deterministic session status and time", () => {
    const briefing = transitionInterviewSession(session, "BRIEFING", 150);
    expect(briefing).toMatchObject({ stage: "BRIEFING", status: "active", updatedAt: 150 });

    expect(() => transitionInterviewSession(session, "SOLUTION_CONSTRUCTION", 150)).toThrow(
      IllegalInterviewStageTransitionError,
    );
    expect(() => transitionInterviewSession(session, "BRIEFING", 99)).toThrow(/occurredAt/);
  });
});
