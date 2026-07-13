import { GoogleGenAI, Modality, type Tool } from "@google/genai";

import {
  liveTokenResultSchema,
  type LiveTokenInput,
  type LiveTokenResult,
} from "@/lib/interview/schemas";
import { AppError, isAbortError } from "@/lib/security/errors";

import { LIVE_INTERVIEWER_SYSTEM_INSTRUCTION } from "./prompts";

const LIVE_FUNCTION_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "request_board_analysis",
        description: "Request a server-owned board analysis and wait for its evidence-backed result.",
        parametersJsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            reason: { type: "string" },
            urgency: { enum: ["wait", "next_pause", "interrupt"] },
          },
          required: ["reason", "urgency"],
        },
      },
      {
        name: "focus_board_elements",
        description: "Request focus on exact IDs returned by the latest validated board analysis.",
        parametersJsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            elementIds: { type: "array", items: { type: "string" }, maxItems: 20 },
            message: { type: "string" },
          },
          required: ["elementIds", "message"],
        },
      },
      {
        name: "record_interview_signal",
        description: "Record an observable competency signal with evidence references.",
        parametersJsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            competency: { type: "string" },
            signal: { type: "string" },
            evidenceRefs: { type: "array", items: { type: "string" }, maxItems: 30 },
          },
          required: ["competency", "signal", "evidenceRefs"],
        },
      },
      {
        name: "advance_interview_stage",
        description: "Recommend a deterministic application-owned stage transition.",
        parametersJsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            nextStage: { type: "string" },
            reason: { type: "string" },
          },
          required: ["nextStage", "reason"],
        },
      },
      {
        name: "inject_constraint",
        description: "Request one allowlisted scenario constraint by ID.",
        parametersJsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: { constraintId: { type: "string" } },
          required: ["constraintId"],
        },
      },
      {
        name: "request_candidate_reflection",
        description: "Ask the candidate to reflect briefly on an interview topic.",
        parametersJsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: { topic: { type: "string" } },
          required: ["topic"],
        },
      },
      {
        name: "finish_interview",
        description: "Recommend ending the interview; the application validates the transition.",
        parametersJsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: { reason: { type: "string" } },
          required: ["reason"],
        },
      },
    ],
  },
];

export async function createScopedLiveEphemeralToken(options: {
  client: GoogleGenAI;
  input: LiveTokenInput;
  model: string;
  now?: Date;
  timeoutMs?: number;
}): Promise<LiveTokenResult> {
  const now = options.now ?? new Date();
  const expiresAt = now.getTime() + 30 * 60 * 1_000;
  const newSessionExpiresAt = now.getTime() + 60 * 1_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const token = await options.client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(expiresAt).toISOString(),
        newSessionExpireTime: new Date(newSessionExpiresAt).toISOString(),
        abortSignal: controller.signal,
        httpOptions: { timeout: options.timeoutMs ?? 10_000 },
        liveConnectConstraints: {
          model: options.model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: {
              parts: [
                {
                  text: `${LIVE_INTERVIEWER_SYSTEM_INSTRUCTION}\n\nSession instruction:\n${options.input.systemInstruction}`,
                },
              ],
            },
            tools: LIVE_FUNCTION_TOOLS,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            contextWindowCompression: {
              triggerTokens: "24000",
              slidingWindow: { targetTokens: "12000" },
            },
            sessionResumption: { transparent: true },
            enableAffectiveDialog: false,
          },
        },
        lockAdditionalFields: [],
      },
    });
    if (!token.name) {
      throw new AppError({
        code: "GEMINI_LIVE_TOKEN_EMPTY",
        message: "Gemini did not return an ephemeral Live token.",
        status: 502,
        retryable: true,
        expose: false,
      });
    }
    return liveTokenResultSchema.parse({
      token: token.name,
      expiresAt,
      newSessionExpiresAt,
      model: options.model,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      code: isAbortError(error) ? "GEMINI_LIVE_TOKEN_TIMEOUT" : "GEMINI_LIVE_TOKEN_FAILED",
      message: "A Gemini Live connection token could not be created.",
      status: 502,
      retryable: true,
      expose: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}
