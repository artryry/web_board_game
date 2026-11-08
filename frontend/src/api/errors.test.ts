import { describe, expect, it } from "vitest";

import { ApiError, unwrap } from "./errors";

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
});
