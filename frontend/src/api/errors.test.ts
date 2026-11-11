import { describe, expect, it } from "vitest";

import { ApiError, errorMessage, unwrap } from "./errors";

describe("ApiError.fromBody", () => {
  it("reads our error body, keeping the extra fields", () => {
    const decks = [{ id: "d1", name: "Bog" }];
    const error = ApiError.fromBody(409, {
      detail: { code: "card_in_use", message: "A deck holds this card", decks },
    });

    expect(error.status).toBe(409);
    expect(error.code).toBe("card_in_use");
    expect(error.message).toBe("A deck holds this card");
    expect(error.extra).toEqual({ decks });
  });

  it("turns FastAPI's 422 list into one message per field", () => {
    const error = ApiError.fromBody(422, {
      detail: [
        { loc: ["body", "email"], msg: "value is not a valid email address", type: "value_error" },
        { loc: ["body", "password"], msg: "String should have at least 8 characters" },
        { loc: ["body", "password"], msg: "a second message for the same field" },
      ],
    });

    expect(error.code).toBe("validation_error");
    expect(error.fieldErrors).toEqual({
      email: "value is not a valid email address",
      password: "String should have at least 8 characters",
    });
  });

  it("falls back to the status for a body it doesn't know", () => {
    const error = ApiError.fromBody(502, "Bad Gateway");

    expect(error.code).toBe("http_502");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("unwrap", () => {
  it("returns the data of a successful call", () => {
    const response = new Response(null, { status: 200 });

    expect(unwrap({ data: { total: 3 }, response })).toEqual({ total: 3 });
  });

  it("throws the error body of a failed call as an ApiError", () => {
    const response = new Response(null, { status: 409 });
    const error = { detail: { code: "username_taken", message: "Taken" } };

    expect(() => unwrap({ error, response })).toThrow(
      expect.objectContaining({ code: "username_taken", status: 409 }),
    );
  });

  it("keeps the answer's request id", () => {
    const response = new Response(null, {
      status: 500,
      headers: { "X-Request-ID": "3f2a9c1e-4b7d-4e3b-8a7c-1d2e3f4a5b6c" },
    });
    const error = { detail: { code: "internal_error", message: "Something went wrong." } };

    expect(() => unwrap({ error, response })).toThrow(
      expect.objectContaining({ requestId: "3f2a9c1e-4b7d-4e3b-8a7c-1d2e3f4a5b6c" }),
    );
  });
});

describe("errorMessage", () => {
  const requestId = "3f2a9c1e-4b7d-4e3b-8a7c-1d2e3f4a5b6c";

  it("ends a server error with its error ID", () => {
    const error = ApiError.fromBody(
      500,
      { detail: { code: "internal_error", message: "Something went wrong." } },
      requestId,
    );

    expect(errorMessage(error)).toBe("Something went wrong. (error ID: 3f2a9c1e)");
  });

  it("leaves other answers as they are", () => {
    const conflict = ApiError.fromBody(
      409,
      { detail: { code: "in_use", message: "In use" } },
      requestId,
    );
    const noId = ApiError.fromBody(502, "Bad Gateway");

    expect(errorMessage(conflict)).toBe("In use");
    expect(errorMessage(noId)).toBe("The request failed (HTTP 502).");
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe(
      "Can't reach the server. Try again.",
    );
  });
});
