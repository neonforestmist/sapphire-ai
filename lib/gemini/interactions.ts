import { GoogleGenAI } from "@google/genai";
import { z, type ZodType } from "zod";

import { AppError, isAbortError, statusFromUnknown } from "@/lib/security/errors";
import type { StructuredLogger } from "@/lib/security/logging";

import { createRepairInstruction } from "./prompts";

export type InteractionContent =
  | { type: "text"; text: string }
  | {
      type: "image";
      data: string;
      mime_type: "image/png" | "image/jpeg" | "image/webp";
    };

export type StructuredInteractionOptions<T> = {
  client: GoogleGenAI;
  model: string;
  systemInstruction: string;
  input: string | InteractionContent[];
  schema: ZodType<T>;
  schemaName: string;
  requestId: string;
  timeoutMs: number;
  maximumTransientRetries: 0 | 1;
  maxOutputTokens?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  logger?: StructuredLogger;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type StructuredInteractionResult<T> = {
  value: T;
  interactionId: string;
  attempts: number;
  repaired: boolean;
};

type ParsedOutput<T> =
  | { success: true; data: T }
  | { success: false; issues: string[] };

export class GeminiStructuredOutputError extends AppError {
  readonly validationIssues: readonly string[];

  constructor(validationIssues: readonly string[], cause?: unknown) {
    super({
      code: "GEMINI_INVALID_STRUCTURED_OUTPUT",
      message: "Gemini returned a response that could not be validated. The interview can continue.",
      status: 502,
      retryable: true,
      expose: true,
      cause,
    });
    this.name = "GeminiStructuredOutputError";
    this.validationIssues = validationIssues;
  }
}

function parseStructuredOutput<T>(text: string, schema: ZodType<T>): ParsedOutput<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      success: false,
      issues: [error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON"],
    };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      success: false,
      issues: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "response"}: ${issue.message}`,
      ),
    };
  }
  return { success: true, data: result.data };
}

export function isTransientGeminiError(error: unknown): boolean {
  if (isAbortError(error)) {
    return false;
  }
  const status = statusFromUnknown(error);
  if (status === 408 || status === 429 || (status !== null && status >= 500 && status <= 599)) {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (typeof error === "object" && error !== null) {
    const code = Reflect.get(error, "code");
    return typeof code === "string" && ["ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"].includes(code);
  }
  return false;
}

function normalizeGeminiError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (isAbortError(error)) {
    return new AppError({
      code: "GEMINI_TIMEOUT",
      message: "Board analysis timed out. The interview can continue and analysis can be retried.",
      status: 504,
      retryable: true,
      expose: true,
      cause: error,
    });
  }

  const providerStatus = statusFromUnknown(error);
  if (providerStatus === 429) {
    return new AppError({
      code: "GEMINI_RATE_LIMITED",
      message: "Gemini is temporarily rate limited. Please wait and try again.",
      status: 503,
      retryable: true,
      expose: true,
      cause: error,
    });
  }
  if (providerStatus === 401 || providerStatus === 403) {
    return new AppError({
      code: "GEMINI_AUTHENTICATION_FAILED",
      message: "Gemini server credentials are not authorized.",
      status: 502,
      expose: false,
      cause: error,
    });
  }
  return new AppError({
    code: "GEMINI_REQUEST_FAILED",
    message: "Gemini analysis is temporarily unavailable. The interview can continue.",
    status: 502,
    retryable: isTransientGeminiError(error),
    expose: true,
    cause: error,
  });
}

function removeUnsupportedGeminiSchemaKeywords(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(removeUnsupportedGeminiSchemaKeywords);
    return;
  }

  const record = value as Record<string, unknown>;
  const anyOf = record.anyOf;
  if (Array.isArray(anyOf) && anyOf.length === 2) {
    const variants = anyOf.filter(
      (variant): variant is Record<string, unknown> => Boolean(variant) && typeof variant === "object" && !Array.isArray(variant),
    );
    const stringVariant = variants.find((variant) => variant.type === "string");
    const nullVariant = variants.find((variant) => variant.type === "null");
    if (stringVariant && nullVariant) {
      delete record.anyOf;
      Object.assign(record, stringVariant, { type: ["string", "null"] });
    }
  }
  // Gemini structured outputs support a JSON Schema subset. Zod emits
  // validation bounds and strict-object flags, but the Interactions API rejects
  // the full generated schema. Runtime Zod validation still enforces every
  // removed constraint after generation.
  delete record.pattern;
  delete record.minLength;
  delete record.maxLength;
  delete record.minimum;
  delete record.maximum;
  delete record.minItems;
  delete record.maxItems;
  delete record.additionalProperties;
  Object.values(record).forEach(removeUnsupportedGeminiSchemaKeywords);
}

export function toGeminiJsonSchema<T>(schema: ZodType<T>, schemaName: string): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, {
    target: "draft-07",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete converted.$schema;
  removeUnsupportedGeminiSchemaKeywords(converted);
  return { title: schemaName, ...converted };
}

export async function createStructuredInteraction<T>(
  options: StructuredInteractionOptions<T>,
): Promise<StructuredInteractionResult<T>> {
  const responseSchema = toGeminiJsonSchema(options.schema, options.schemaName);
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let remainingTransientRetries = options.maximumTransientRetries;
  let attempts = 0;

  const execute = async (input: string | InteractionContent[]) => {
    while (true) {
      attempts += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      const startedAt = Date.now();
      try {
        const interaction = await options.client.interactions.create(
          {
            model: options.model,
            system_instruction: options.systemInstruction,
            input,
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: responseSchema,
            },
            generation_config: {
              thinking_level: options.thinkingLevel ?? "medium",
              max_output_tokens: options.maxOutputTokens ?? 4_096,
              temperature: 0.2,
            },
            store: false,
          },
          {
            signal: controller.signal,
            timeout_ms: options.timeoutMs,
            retries: { strategy: "none" },
            maxRetries: 0,
          },
        );
        options.logger?.info("gemini.interaction.completed", {
          requestId: options.requestId,
          model: options.model,
          latencyMs: Date.now() - startedAt,
          status: interaction.status,
          attempt: attempts,
        });
        return { interactionId: interaction.id, text: interaction.output_text ?? "" };
      } catch (error) {
        const normalizedError = controller.signal.aborted && !isAbortError(error)
          ? new DOMException("Gemini request timed out", "AbortError")
          : error;
        const shouldRetry = remainingTransientRetries > 0 && isTransientGeminiError(normalizedError);
        options.logger?.warn("gemini.interaction.failed", {
          requestId: options.requestId,
          model: options.model,
          latencyMs: Date.now() - startedAt,
          status: statusFromUnknown(normalizedError) ?? "error",
          attempt: attempts,
          retrying: shouldRetry,
        });
        if (!shouldRetry) {
          throw normalizeGeminiError(normalizedError);
        }
        remainingTransientRetries -= 1;
        await sleep(250);
      } finally {
        clearTimeout(timeout);
      }
    }
  };

  const initial = await execute(options.input);
  const parsed = parseStructuredOutput(initial.text, options.schema);
  if (parsed.success) {
    return {
      value: parsed.data,
      interactionId: initial.interactionId,
      attempts,
      repaired: false,
    };
  }

  options.logger?.warn("gemini.interaction.repair_requested", {
    requestId: options.requestId,
    model: options.model,
    issueCount: parsed.issues.length,
  });
  const repaired = await execute(
    createRepairInstruction({ invalidOutput: initial.text, validationIssues: parsed.issues }),
  );
  const repairedParsed = parseStructuredOutput(repaired.text, options.schema);
  if (!repairedParsed.success) {
    throw new GeminiStructuredOutputError(repairedParsed.issues);
  }

  return {
    value: repairedParsed.data,
    interactionId: repaired.interactionId,
    attempts,
    repaired: true,
  };
}
