export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export const MAX_STACK_LENGTH = 2000;

type ErrorLike = Pick<Error, "name" | "message"> & { stack?: unknown };

/**
 * Whether a value looks like an Error. By shape: a DOMException or an error from another frame
 * isn't always an `instanceof Error`.
 */
export function isErrorLike(value: unknown): value is ErrorLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "message" in value &&
    typeof value.name === "string" &&
    typeof value.message === "string"
  );
}

/** Anything thrown, as plain data a log entry can carry. */
export function serializeError(error: unknown): SerializedError {
  if (isErrorLike(error)) {
    const stack = typeof error.stack === "string" ? error.stack : undefined;
    return {
      name: error.name,
      message: error.message,
      ...(stack === undefined ? {} : { stack: stack.slice(0, MAX_STACK_LENGTH) }),
    };
  }
  return { name: "NonError", message: describe(error) };
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  // These have no JSON form.
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    // A circular object, for example.
    return Object.prototype.toString.call(value);
  }
}
