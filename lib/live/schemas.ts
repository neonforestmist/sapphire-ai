import { z } from "zod";

import {
  competencyNameSchema,
  domainIdSchema,
  interviewStageSchema,
} from "@/lib/interview/schemas";
import { stableBoardElementIdSchema } from "@/lib/whiteboard/schemas";

const hasUniqueValues = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const liveToolCallIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[\x21-\x7E]+$/, "Tool call IDs must contain printable non-space ASCII characters");

const shortLiveTextSchema = z.string().trim().min(1).max(1_000);

const uniqueBoardElementIdsSchema = z
  .array(stableBoardElementIdSchema)
  .min(1)
  .max(20)
  .refine(hasUniqueValues, "Element IDs must not contain duplicates");

const uniqueEvidenceReferenceIdsSchema = z
  .array(domainIdSchema)
  .min(1)
  .max(30)
  .refine(hasUniqueValues, "Evidence reference IDs must not contain duplicates");

export const requestBoardAnalysisArgsSchema = z
  .object({
    reason: shortLiveTextSchema,
    urgency: z.enum(["wait", "next_pause", "interrupt"]),
  })
  .strict();

export const focusBoardElementsArgsSchema = z
  .object({
    elementIds: uniqueBoardElementIdsSchema,
    message: shortLiveTextSchema,
  })
  .strict();

export const recordInterviewSignalArgsSchema = z
  .object({
    competency: competencyNameSchema,
    signal: shortLiveTextSchema,
    evidenceRefs: uniqueEvidenceReferenceIdsSchema,
  })
  .strict();

export const advanceInterviewStageArgsSchema = z
  .object({
    nextStage: interviewStageSchema,
    reason: shortLiveTextSchema,
  })
  .strict();

export const injectConstraintArgsSchema = z
  .object({
    constraintId: domainIdSchema,
  })
  .strict();

export const requestCandidateReflectionArgsSchema = z
  .object({
    topic: shortLiveTextSchema,
  })
  .strict();

export const finishInterviewArgsSchema = z
  .object({
    reason: shortLiveTextSchema,
  })
  .strict();

export const liveToolNameSchema = z.enum([
  "request_board_analysis",
  "focus_board_elements",
  "record_interview_signal",
  "advance_interview_stage",
  "inject_constraint",
  "request_candidate_reflection",
  "finish_interview",
]);

export type LiveToolName = z.infer<typeof liveToolNameSchema>;
export type RequestBoardAnalysisArgs = z.infer<typeof requestBoardAnalysisArgsSchema>;
export type FocusBoardElementsArgs = z.infer<typeof focusBoardElementsArgsSchema>;
export type RecordInterviewSignalArgs = z.infer<typeof recordInterviewSignalArgsSchema>;
export type AdvanceInterviewStageArgs = z.infer<typeof advanceInterviewStageArgsSchema>;
export type InjectConstraintArgs = z.infer<typeof injectConstraintArgsSchema>;
export type RequestCandidateReflectionArgs = z.infer<
  typeof requestCandidateReflectionArgsSchema
>;
export type FinishInterviewArgs = z.infer<typeof finishInterviewArgsSchema>;

export type LiveToolArgsByName = {
  request_board_analysis: RequestBoardAnalysisArgs;
  focus_board_elements: FocusBoardElementsArgs;
  record_interview_signal: RecordInterviewSignalArgs;
  advance_interview_stage: AdvanceInterviewStageArgs;
  inject_constraint: InjectConstraintArgs;
  request_candidate_reflection: RequestCandidateReflectionArgs;
  finish_interview: FinishInterviewArgs;
};

export const liveToolArgsSchemas = {
  request_board_analysis: requestBoardAnalysisArgsSchema,
  focus_board_elements: focusBoardElementsArgsSchema,
  record_interview_signal: recordInterviewSignalArgsSchema,
  advance_interview_stage: advanceInterviewStageArgsSchema,
  inject_constraint: injectConstraintArgsSchema,
  request_candidate_reflection: requestCandidateReflectionArgsSchema,
  finish_interview: finishInterviewArgsSchema,
} satisfies { [Name in LiveToolName]: z.ZodType<LiveToolArgsByName[Name]> };

/** Provider-neutral envelope accepted from a Live transport. */
export const liveToolCallEnvelopeSchema = z
  .object({
    id: liveToolCallIdSchema,
    name: z.string().trim().min(1).max(128),
    args: z.unknown(),
  })
  .strict();

export type LiveToolCallEnvelope = z.infer<typeof liveToolCallEnvelopeSchema>;

export type LiveToolCall = {
  [Name in LiveToolName]: {
    id: string;
    name: Name;
    args: LiveToolArgsByName[Name];
  };
}[LiveToolName];

export function parseLiveToolCall(input: unknown): LiveToolCall {
  const envelope = liveToolCallEnvelopeSchema.parse(input);
  const name = liveToolNameSchema.parse(envelope.name);

  switch (name) {
    case "request_board_analysis":
      return { ...envelope, name, args: requestBoardAnalysisArgsSchema.parse(envelope.args) };
    case "focus_board_elements":
      return { ...envelope, name, args: focusBoardElementsArgsSchema.parse(envelope.args) };
    case "record_interview_signal":
      return { ...envelope, name, args: recordInterviewSignalArgsSchema.parse(envelope.args) };
    case "advance_interview_stage":
      return { ...envelope, name, args: advanceInterviewStageArgsSchema.parse(envelope.args) };
    case "inject_constraint":
      return { ...envelope, name, args: injectConstraintArgsSchema.parse(envelope.args) };
    case "request_candidate_reflection":
      return {
        ...envelope,
        name,
        args: requestCandidateReflectionArgsSchema.parse(envelope.args),
      };
    case "finish_interview":
      return { ...envelope, name, args: finishInterviewArgsSchema.parse(envelope.args) };
  }
}
