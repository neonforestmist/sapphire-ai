const SENSITIVE_KEY = /(api.?key|authorization|cookie|token|secret|password|transcript|image|scene|prompt|input|output|body)/i;
const MAX_LOG_STRING_LENGTH = 512;

export type LogLevel = "debug" | "info" | "warn" | "error";
export type SafeLogFields = Record<string, string | number | boolean | null | undefined>;

function sanitizeFields(fields: SafeLogFields): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || SENSITIVE_KEY.test(key)) {
      continue;
    }
    safe[key] =
      typeof value === "string" && value.length > MAX_LOG_STRING_LENGTH
        ? `${value.slice(0, MAX_LOG_STRING_LENGTH)}…`
        : value;
  }
  return safe;
}

export type StructuredLogger = {
  debug(event: string, fields?: SafeLogFields): void;
  info(event: string, fields?: SafeLogFields): void;
  warn(event: string, fields?: SafeLogFields): void;
  error(event: string, fields?: SafeLogFields): void;
};

export function createStructuredLogger(service = "sapphire-ai"): StructuredLogger {
  function emit(level: LogLevel, event: string, fields: SafeLogFields = {}): void {
    const line = JSON.stringify({
      severity: level.toUpperCase(),
      service,
      event,
      timestamp: new Date().toISOString(),
      ...sanitizeFields(fields),
    });
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
