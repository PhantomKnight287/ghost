import { describe, expect, it } from "bun:test";

import { apiErrorMessage } from "./client";

describe("apiErrorMessage", () => {
  it("reads the filter's message, joins a validation pipe's list, and falls back otherwise", () => {
    expect(apiErrorMessage({ message: "Repository not found" })).toBe(
      "Repository not found",
    );
    expect(
      apiErrorMessage({
        message: ["target must be shorter than or equal to 250 characters"],
      }),
    ).toBe("target must be shorter than or equal to 250 characters");
    expect(apiErrorMessage({ message: [] })).toBe("Something went wrong");
    expect(apiErrorMessage(undefined)).toBe("Something went wrong");
  });
});
