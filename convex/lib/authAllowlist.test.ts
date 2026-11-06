// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  allowedSignupEmails,
  assertSignupEmailAllowed,
} from "./authAllowlist";

describe("signup email allowlist", () => {
  it("normalizes a comma-separated environment value", () => {
    expect([
      ...allowedSignupEmails(
        " Owner@Example.test, second@example.test ,, ",
      ),
    ]).toEqual(["owner@example.test", "second@example.test"]);
  });

  it("allows a configured email regardless of case", () => {
    expect(() =>
      assertSignupEmailAllowed(
        "OWNER@example.test",
        "owner@example.test",
      ),
    ).not.toThrow();
  });

  it("rejects an email that is not configured", () => {
    expect(() =>
      assertSignupEmailAllowed(
        "visitor@example.test",
        "owner@example.test",
      ),
    ).toThrow("This Tasky deployment is private.");
  });

  it("fails closed when the environment value is missing", () => {
    expect(() =>
      assertSignupEmailAllowed("owner@example.test", undefined),
    ).toThrow("This Tasky deployment is private.");
  });
});
