/**
 * An error answer from the API. Our own errors have the body
 * `{"detail": {"code", "message", ...extra}}`. FastAPI's own 422 has `{"detail": [{loc, msg}]}`,
 * which becomes the code `validation_error` with one message per field.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Readonly<Record<string, unknown>>;
  readonly fieldErrors: Readonly<Record<string, string>>;
  /** The `X-Request-ID` of the answer: the server's log lines for this request carry it. */
  readonly requestId: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
    fieldErrors: Record<string, string> = {},
    requestId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.fieldErrors = fieldErrors;
    this.requestId = requestId;
  }

  static fromBody(status: number, body: unknown, requestId: string | null = null): ApiError {
    const detail = isRecord(body) ? body.detail : undefined;
    if (isRecord(detail) && typeof detail.code === "string") {
      const { code, message, ...extra } = detail;
      const text = typeof message === "string" ? message : code;
      return new ApiError(status, code, text, extra, {}, requestId);
    }
    if (Array.isArray(detail)) {
      const fieldErrors = fieldErrorsFrom(detail);
      const text = "Some fields are invalid.";
      return new ApiError(status, "validation_error", text, {}, fieldErrors, requestId);
    }
    const text = `The request failed (HTTP ${status}).`;
    return new ApiError(status, `http_${status}`, text, {}, {}, requestId);
  }
}

/** The first characters of a request id: enough to find its line in the server's log. */
export const ERROR_ID_LENGTH = 8;

/**
 * A failed request's message for the user: the server's own, or a network hint. A server error
 * ends with its error ID, so a report of it can be found in the logs.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Can't reach the server. Try again.";
  if (error.status < 500 || error.requestId === null) return error.message;
  return `${error.message} (error ID: ${error.requestId.slice(0, ERROR_ID_LENGTH)})`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `detail.code` of an error body, or null when the body has none. */
export function errorCode(body: unknown): string | null {
  const detail = isRecord(body) ? body.detail : undefined;
  return isRecord(detail) && typeof detail.code === "string" ? detail.code : null;
}

interface CallResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

// openapi-fetch returns `{data, response} | {error, response}`: this is the success arm's data.
type SuccessData<R> = R extends { data: infer D; error?: never } ? D : never;

/** Returns an openapi-fetch call's data, or throws its error body as an `ApiError`. */
export function unwrap<R extends CallResult>(result: R): SuccessData<R> {
  if (!result.response.ok) {
    const requestId = result.response.headers.get("X-Request-ID");
    throw ApiError.fromBody(result.response.status, result.error, requestId);
  }
  return result.data as SuccessData<R>;
}

function fieldErrorsFrom(items: unknown[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const item of items) {
    if (!isRecord(item) || !Array.isArray(item.loc) || typeof item.msg !== "string") continue;
    // loc is like ["body", "email"]: the last part names the field.
    const field: unknown = item.loc.at(-1);
    if (typeof field !== "string" && typeof field !== "number") continue;
    errors[String(field)] ??= item.msg;
  }
  return errors;
}
