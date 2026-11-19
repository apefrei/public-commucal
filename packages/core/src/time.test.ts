import { describe, expect, it } from "vitest";
import { toTenantIsoString, wallClockToInstant } from "./time.ts";

describe("wallClockToInstant", () => {
  it("uses CET (+01:00) in winter", () => {
    const instant = wallClockToInstant(Temporal.PlainDateTime.from("2026-01-15T07:00"));
    expect(instant.toString()).toBe("2026-01-15T06:00:00Z");
  });

  it("uses CEST (+02:00) in summer", () => {
    const instant = wallClockToInstant(Temporal.PlainDateTime.from("2026-07-15T07:00"));
    expect(instant.toString()).toBe("2026-07-15T05:00:00Z");
  });

  it("moves a time in the spring DST gap forward by one hour", () => {
    const instant = wallClockToInstant(Temporal.PlainDateTime.from("2026-03-29T02:30"));
    expect(toTenantIsoString(instant)).toBe("2026-03-29T03:30:00+02:00");
  });

  it("picks the earlier instant in the autumn DST overlap", () => {
    const instant = wallClockToInstant(Temporal.PlainDateTime.from("2026-10-25T02:30"));
    expect(toTenantIsoString(instant)).toBe("2026-10-25T02:30:00+02:00");
  });
});
