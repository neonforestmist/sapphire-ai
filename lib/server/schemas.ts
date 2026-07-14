import { z } from "zod";

import {
  boardImageInputSchema,
  domainIdSchema,
  experienceLevelSchema,
  interviewTypeSchema,
  transcriptSegmentSchema,
} from "@/lib/interview/schemas";
import {
  boardDiffSchema,
  normalizedBoardSceneSchema,
} from "@/lib/whiteboard/schemas";

export const createInterviewRequestSchema = z
  .object({
    scenarioId: z.literal("global-rate-limiter"),
    mode: z.enum(["demo", "normal"]).default("demo"),
    interviewType: interviewTypeSchema,
    targetRole: z.string().trim().min(2).max(120),
    experienceLevel: experienceLevelSchema,
    inputMode: z.enum(["text", "voice"]),
    consent: z
      .object({
        transcript: z.literal(true),
        microphone: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.inputMode === "text" && request.consent.microphone) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Text-only sessions cannot include microphone consent.",
        path: ["consent", "microphone"],
      });
    }
    if (request.inputMode === "voice" && !request.consent.microphone) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Voice sessions require microphone consent.",
        path: ["consent", "microphone"],
      });
    }
  });

export type CreateInterviewRequest = z.infer<typeof createInterviewRequestSchema>;

export const appendTranscriptEventRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("transcript.input.finalized"),
      segment: transcriptSegmentSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("transcript.output.finalized"),
      segment: transcriptSegmentSchema,
    })
    .strict(),
]);

export type AppendTranscriptEventRequest = z.infer<
  typeof appendTranscriptEventRequestSchema
>;

export const analyzeBoardRequestSchema = z
  .object({
    scene: normalizedBoardSceneSchema,
    // The client diff is validated to reject malformed external data, but the
    // server recomputes it from persisted snapshots before model invocation.
    diff: boardDiffSchema.optional(),
    boardImage: boardImageInputSchema.nullish().transform((value) => value ?? null),
    triggerReason: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .default("Candidate requested board analysis."),
    urgency: z.enum(["wait", "next_pause", "interrupt"]).default("next_pause"),
  })
  .strict();

export type AnalyzeBoardRequest = z.infer<typeof analyzeBoardRequestSchema>;

export const finishInterviewRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .default("Candidate ended the interview."),
  })
  .strict();

export const liveTokenRequestSchema = z
  .object({ sessionId: domainIdSchema })
  .strict();

export type LiveTokenRequest = z.infer<typeof liveTokenRequestSchema>;
