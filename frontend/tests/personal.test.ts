import { describe, expect, test } from "bun:test";
import { exactTime, parseStatus, personalRecord } from "../src/features/personal/model";
import { calendarFile } from "../src/utils/calendar";
describe("local personal status", () => {
  test("extracts whitelisted fields without retaining secrets", () => {
    const parsed = parseStatus(JSON.stringify({ token: "fixture-only", rate_limit: { primary_window: { used_percent: 42, reset_at: 1893456000 } } }));
    expect(parsed).toEqual({ primaryUsed: 42, primaryReset: "2030-01-01T00:00:00.000Z" });
    expect(JSON.stringify(parsed)).not.toContain("token");
  });
  test("does not guess timezone or hour-only deadlines", () => {
    expect(parseStatus("5h limit: 85% left, resets 15:30")).toEqual({ primaryUsed: 15 });
    expect(exactTime("2030-01-01T12:00:00")).toBeNull();
    expect(exactTime("2030-02-30T12:00:00Z")).toBeNull();
    expect(parseStatus("weekly: 60% used, resets 2030-01-01T12:00:00+08:00")).toEqual({ secondaryUsed: 60, secondaryReset: "2030-01-01T04:00:00.000Z" });
  });
  test("invalid ranges and corrupted records do not become quota", () => {
    expect(parseStatus("5h 110% used")).toBeNull(); expect(parseStatus("x".repeat(50001))).toBeNull();
    expect(personalRecord({version: 2})).toBeNull();
  });
  test("calendar values cannot inject properties; unicode folds at 75 octets", () => {
    const file = calendarFile([{ id: "own", at: "2030-01-01T00:00:00Z", title: "重置".repeat(35) + "\r\nBEGIN:VALARM", description: "a,b;c\\d" }]);
    expect(file).toContain("DTSTART:20300101T000000Z"); expect(file).not.toContain("\r\nBEGIN:VALARM");
    expect(file.split("\r\n").every(line => new TextEncoder().encode(line).length <= 75)).toBeTrue();
    expect(file).toContain("a\\,b\\;c\\\\d");
  });
});
