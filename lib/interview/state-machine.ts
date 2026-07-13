import {
  interviewSessionSchema,
  interviewStageSchema,
  type InterviewSession,
  type InterviewStage,
} from "./schemas";

export const LEGAL_INTERVIEW_TRANSITIONS: Readonly<
  Record<InterviewStage, readonly InterviewStage[]>
> = {
  SETUP: ["BRIEFING"],
  BRIEFING: ["REQUIREMENT_CLARIFICATION"],
  REQUIREMENT_CLARIFICATION: ["INITIAL_DECOMPOSITION"],
  INITIAL_DECOMPOSITION: ["SOLUTION_CONSTRUCTION"],
  SOLUTION_CONSTRUCTION: ["CONSTRAINT_INJECTION"],
  CONSTRAINT_INJECTION: ["TRADEOFF_CHALLENGE"],
  TRADEOFF_CHALLENGE: ["REFLECTION"],
  REFLECTION: ["GENERATING_REPORT"],
  GENERATING_REPORT: ["COMPLETE"],
  COMPLETE: [],
};

export class IllegalInterviewStageTransitionError extends Error {
  public readonly from: InterviewStage;
  public readonly to: InterviewStage;

  public constructor(from: InterviewStage, to: InterviewStage) {
    super(`Illegal interview stage transition: ${from} -> ${to}`);
    this.name = "IllegalInterviewStageTransitionError";
    this.from = from;
    this.to = to;
  }
}

export const isLegalInterviewStageTransition = (
  fromInput: InterviewStage,
  toInput: InterviewStage,
): boolean => {
  const from = interviewStageSchema.parse(fromInput);
  const to = interviewStageSchema.parse(toInput);
  return LEGAL_INTERVIEW_TRANSITIONS[from].includes(to);
};

export const assertLegalInterviewStageTransition = (
  from: InterviewStage,
  to: InterviewStage,
): void => {
  if (!isLegalInterviewStageTransition(from, to)) {
    throw new IllegalInterviewStageTransitionError(from, to);
  }
};

export const getNextInterviewStage = (stageInput: InterviewStage): InterviewStage | null => {
  const stage = interviewStageSchema.parse(stageInput);
  return LEGAL_INTERVIEW_TRANSITIONS[stage][0] ?? null;
};

export const deriveSessionStatus = (
  stage: InterviewStage,
): InterviewSession["status"] => {
  if (stage === "GENERATING_REPORT") {
    return "generating_report";
  }
  if (stage === "COMPLETE") {
    return "complete";
  }
  return "active";
};

export const transitionInterviewSession = (
  sessionInput: InterviewSession,
  nextStage: InterviewStage,
  occurredAt: number,
): InterviewSession => {
  const session = interviewSessionSchema.parse(sessionInput);
  assertLegalInterviewStageTransition(session.stage, nextStage);

  if (!Number.isSafeInteger(occurredAt) || occurredAt < session.updatedAt) {
    throw new RangeError("occurredAt must be a safe integer at or after the prior update");
  }

  return interviewSessionSchema.parse({
    ...session,
    stage: nextStage,
    status: deriveSessionStatus(nextStage),
    updatedAt: occurredAt,
  });
};
