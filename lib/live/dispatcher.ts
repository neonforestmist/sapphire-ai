import { z } from "zod";

import {
  advanceInterviewStageArgsSchema,
  finishInterviewArgsSchema,
  focusBoardElementsArgsSchema,
  injectConstraintArgsSchema,
  liveToolCallEnvelopeSchema,
  liveToolNameSchema,
  recordInterviewSignalArgsSchema,
  requestBoardAnalysisArgsSchema,
  requestCandidateReflectionArgsSchema,
  type AdvanceInterviewStageArgs,
  type FinishInterviewArgs,
  type FocusBoardElementsArgs,
  type InjectConstraintArgs,
  type LiveToolName,
  type RecordInterviewSignalArgs,
  type RequestBoardAnalysisArgs,
  type RequestCandidateReflectionArgs,
} from "./schemas";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type LiveToolHandlerContext = Readonly<{
  callId: string;
  toolName: LiveToolName;
  signal: AbortSignal | undefined;
}>;

type MaybePromise<T> = T | Promise<T>;
type LiveToolHandler<Args> = (
  args: Readonly<Args>,
  context: LiveToolHandlerContext,
) => MaybePromise<unknown>;

/**
 * The application supplies every hook and remains authoritative for mutations,
 * stage transitions, persistence, and permissions.
 */
export type LiveToolHandlers = Readonly<{
  request_board_analysis: LiveToolHandler<RequestBoardAnalysisArgs>;
  focus_board_elements: LiveToolHandler<FocusBoardElementsArgs>;
  record_interview_signal: LiveToolHandler<RecordInterviewSignalArgs>;
  advance_interview_stage: LiveToolHandler<AdvanceInterviewStageArgs>;
  inject_constraint: LiveToolHandler<InjectConstraintArgs>;
  request_candidate_reflection: LiveToolHandler<RequestCandidateReflectionArgs>;
  finish_interview: LiveToolHandler<FinishInterviewArgs>;
}>;

export type LiveToolErrorCode =
  | "INVALID_TOOL_CALL"
  | "UNKNOWN_TOOL"
  | "INVALID_ARGUMENTS"
  | "UNKNOWN_BOARD_ELEMENT_IDS"
  | "APPLICATION_REJECTED"
  | "HANDLER_FAILED";

export type LiveToolSuccessResponse = Readonly<{
  id: string;
  name: string;
  response: Readonly<{
    ok: true;
    result: JsonValue;
  }>;
}>;

export type LiveToolFailureResponse = Readonly<{
  id: string;
  name: string;
  response: Readonly<{
    ok: false;
    error: Readonly<{
      code: LiveToolErrorCode;
      message: string;
      retryable: boolean;
      details?: JsonValue;
    }>;
  }>;
}>;

export type LiveToolResponse = LiveToolSuccessResponse | LiveToolFailureResponse;

export class LiveToolApplicationError extends Error {
  public readonly publicMessage: string;
  public readonly retryable: boolean;

  public constructor(options: {
    publicMessage: string;
    retryable?: boolean;
  }) {
    super("Live tool execution was rejected by the application");
    this.name = "LiveToolApplicationError";
    this.publicMessage = options.publicMessage;
    this.retryable = options.retryable ?? false;
  }
}

export type LiveToolDispatchOptions = Readonly<{
  handlers: LiveToolHandlers;
  /** Return only currently active (not deleted) element IDs. */
  getKnownBoardElementIds: () => Iterable<string>;
}>;

export type LiveToolDispatchRequest = Readonly<{
  call: unknown;
  signal?: AbortSignal;
}>;

const RESPONSE_STRING_LIMIT = 2_000;
const RESPONSE_ARRAY_LIMIT = 100;
const RESPONSE_OBJECT_KEY_LIMIT = 100;
const RESPONSE_DEPTH_LIMIT = 6;
const SENSITIVE_KEY = /(?:api[-_]?key|authorization|credential|password|secret|token)/i;

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/[^\x21-\x7E]/g, "").slice(0, 128);
  return normalized || fallback;
}

function sanitizeString(value: string): string {
  return value.length <= RESPONSE_STRING_LIMIT
    ? value
    : `${value.slice(0, RESPONSE_STRING_LIMIT)}…`;
}

/** Convert arbitrary handler output into bounded, credential-safe JSON. */
export function sanitizeLiveToolResult(value: unknown, depth = 0): JsonValue {
  if (depth >= RESPONSE_DEPTH_LIMIT) return "[truncated]";
  if (value === null) return null;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return null;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, RESPONSE_ARRAY_LIMIT)
      .map((item) => sanitizeLiveToolResult(item, depth + 1));
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return "[error]";
  if (typeof value === "object") {
    const output: Record<string, JsonValue> = {};
    for (const [key, nestedValue] of Object.entries(value).slice(0, RESPONSE_OBJECT_KEY_LIMIT)) {
      output[key] = SENSITIVE_KEY.test(key)
        ? "[redacted]"
        : sanitizeLiveToolResult(nestedValue, depth + 1);
    }
    return output;
  }
  return null;
}

function failure(options: {
  id: string;
  name: string;
  code: LiveToolErrorCode;
  message: string;
  retryable?: boolean;
  details?: unknown;
}): LiveToolFailureResponse {
  return {
    id: safeLabel(options.id, "invalid-call"),
    name: safeLabel(options.name, "unknown"),
    response: {
      ok: false,
      error: {
        code: options.code,
        message: sanitizeString(options.message),
        retryable: options.retryable ?? false,
        ...(options.details === undefined
          ? {}
          : { details: sanitizeLiveToolResult(options.details) }),
      },
    },
  };
}

function validationDetails(error: z.ZodError): JsonValue {
  return {
    issues: error.issues.slice(0, 10).map((issue) => ({
      path: issue.path.map(String).join(".") || "args",
      code: issue.code,
    })),
  };
}

function unknownBoardElementIds(
  requestedIds: readonly string[],
  knownIds: Iterable<string>,
): string[] {
  const known = new Set(knownIds);
  return requestedIds.filter((id) => !known.has(id));
}

async function execute<Args>(options: {
  id: string;
  name: LiveToolName;
  args: Args;
  signal: AbortSignal | undefined;
  handler: LiveToolHandler<Args>;
}): Promise<LiveToolResponse> {
  try {
    const result = await options.handler(options.args, {
      callId: options.id,
      toolName: options.name,
      signal: options.signal,
    });
    return {
      id: options.id,
      name: options.name,
      response: { ok: true, result: sanitizeLiveToolResult(result) },
    };
  } catch (error) {
    if (error instanceof LiveToolApplicationError) {
      return failure({
        id: options.id,
        name: options.name,
        code: "APPLICATION_REJECTED",
        message: error.publicMessage,
        retryable: error.retryable,
      });
    }
    return failure({
      id: options.id,
      name: options.name,
      code: "HANDLER_FAILED",
      message: "The application could not execute this Live action.",
      retryable: true,
    });
  }
}

export function createLiveToolDispatcher(options: LiveToolDispatchOptions): {
  dispatch(request: LiveToolDispatchRequest): Promise<LiveToolResponse>;
} {
  return {
    async dispatch(request): Promise<LiveToolResponse> {
      const envelopeResult = liveToolCallEnvelopeSchema.safeParse(request.call);
      if (!envelopeResult.success) {
        const candidate =
          request.call && typeof request.call === "object"
            ? (request.call as Record<string, unknown>)
            : {};
        return failure({
          id: safeLabel(candidate.id, "invalid-call"),
          name: safeLabel(candidate.name, "unknown"),
          code: "INVALID_TOOL_CALL",
          message: "The Live tool call envelope is invalid.",
          details: validationDetails(envelopeResult.error),
        });
      }

      const { id, name: unparsedName, args: unparsedArgs } = envelopeResult.data;
      const nameResult = liveToolNameSchema.safeParse(unparsedName);
      if (!nameResult.success) {
        return failure({
          id,
          name: unparsedName,
          code: "UNKNOWN_TOOL",
          message: "The requested Live tool is not supported.",
        });
      }

      const name = nameResult.data;
      switch (name) {
        case "request_board_analysis": {
          const parsed = requestBoardAnalysisArgsSchema.safeParse(unparsedArgs);
          if (!parsed.success) {
            return failure({
              id,
              name,
              code: "INVALID_ARGUMENTS",
              message: "The board-analysis arguments are invalid.",
              details: validationDetails(parsed.error),
            });
          }
          return execute({
            id,
            name,
            args: parsed.data,
            signal: request.signal,
            handler: options.handlers.request_board_analysis,
          });
        }
        case "focus_board_elements": {
          const parsed = focusBoardElementsArgsSchema.safeParse(unparsedArgs);
          if (!parsed.success) {
            return failure({
              id,
              name,
              code: "INVALID_ARGUMENTS",
              message: "The board-focus arguments are invalid.",
              details: validationDetails(parsed.error),
            });
          }
          let unknownIds: string[];
          try {
            unknownIds = unknownBoardElementIds(
              parsed.data.elementIds,
              options.getKnownBoardElementIds(),
            );
          } catch {
            return failure({
              id,
              name,
              code: "HANDLER_FAILED",
              message: "The application could not validate the current board scene.",
              retryable: true,
            });
          }
          if (unknownIds.length > 0) {
            return failure({
              id,
              name,
              code: "UNKNOWN_BOARD_ELEMENT_IDS",
              message: "The focus request referenced board elements outside the current scene.",
              details: { unknownElementIds: unknownIds },
            });
          }
          return execute({
            id,
            name,
            args: parsed.data,
            signal: request.signal,
            handler: options.handlers.focus_board_elements,
          });
        }
        case "record_interview_signal": {
          const parsed = recordInterviewSignalArgsSchema.safeParse(unparsedArgs);
          if (!parsed.success) {
            return failure({
              id,
              name,
              code: "INVALID_ARGUMENTS",
              message: "The interview-signal arguments are invalid.",
              details: validationDetails(parsed.error),
            });
          }
          return execute({
            id,
            name,
            args: parsed.data,
            signal: request.signal,
            handler: options.handlers.record_interview_signal,
          });
        }
        case "advance_interview_stage": {
          const parsed = advanceInterviewStageArgsSchema.safeParse(unparsedArgs);
          if (!parsed.success) {
            return failure({
              id,
              name,
              code: "INVALID_ARGUMENTS",
              message: "The stage-transition arguments are invalid.",
              details: validationDetails(parsed.error),
            });
          }
          return execute({
            id,
            name,
            args: parsed.data,
            signal: request.signal,
            handler: options.handlers.advance_interview_stage,
          });
        }
        case "inject_constraint": {
          const parsed = injectConstraintArgsSchema.safeParse(unparsedArgs);
          if (!parsed.success) {
            return failure({
              id,
              name,
              code: "INVALID_ARGUMENTS",
              message: "The constraint arguments are invalid.",
              details: validationDetails(parsed.error),
            });
          }
          return execute({
            id,
            name,
            args: parsed.data,
            signal: request.signal,
            handler: options.handlers.inject_constraint,
          });
        }
        case "request_candidate_reflection": {
          const parsed = requestCandidateReflectionArgsSchema.safeParse(unparsedArgs);
          if (!parsed.success) {
            return failure({
              id,
              name,
              code: "INVALID_ARGUMENTS",
              message: "The reflection arguments are invalid.",
              details: validationDetails(parsed.error),
            });
          }
          return execute({
            id,
            name,
            args: parsed.data,
            signal: request.signal,
            handler: options.handlers.request_candidate_reflection,
          });
        }
        case "finish_interview": {
          const parsed = finishInterviewArgsSchema.safeParse(unparsedArgs);
          if (!parsed.success) {
            return failure({
              id,
              name,
              code: "INVALID_ARGUMENTS",
              message: "The finish-interview arguments are invalid.",
              details: validationDetails(parsed.error),
            });
          }
          return execute({
            id,
            name,
            args: parsed.data,
            signal: request.signal,
            handler: options.handlers.finish_interview,
          });
        }
      }
    },
  };
}
