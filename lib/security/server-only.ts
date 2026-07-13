import { AppError } from "./errors";

/** Runtime guard for modules that may access permanent credentials. */
export function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new AppError({
      code: "SERVER_ONLY_MODULE",
      message: "This capability is only available on the server.",
      status: 500,
      expose: false,
    });
  }
}
