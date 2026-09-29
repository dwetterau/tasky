import { describe, expect, it } from "vitest";
import {
  calendarProgress,
  calendarWindow,
  type CalendarSchedule,
  validateCalendarSchedule,
} from "./lib/recurrence";
import { evaluateSignal } from "./lib/signalStatus";

const timezone = "America/New_York";

describe("calendar recurrence", () => {
  it("paces a twice-monthly goal instead of making all work due immediately", () => {
    const schedule: CalendarSchedule = {
      rrule: "FREQ=MONTHLY",
      startDate: "2026-01-01",
      due: { type: "evenly_spaced" },
    };
    const now = Date.parse("2026-09-15T16:00:00Z");
    const window = calendarWindow(schedule, 2, now, timezone);
    const progress = calendarProgress(window, 1, 2, now);

    expect(progress).toMatchObject({
      completedCount: 1,
      requiredCountByNow: 1,
      overdueCount: 0,
      nextDueAt: Date.parse("2026-09-30T04:00:00Z"),
    });
    expect(
      evaluateSignal(
        {
          kind: "activity",
          target: { type: "schedule", schedule, targetCount: 2 },
        },
        now,
        7 * 24 * 60 * 60 * 1000,
        progress,
      ),
    ).toMatchObject({
      attention: "ok",
      isComplete: false,
      ratio: 0.5,
    });
  });

  it("marks a missed monthly checkpoint due", () => {
    const schedule: CalendarSchedule = {
      rrule: "FREQ=MONTHLY",
      startDate: "2026-01-01",
      due: { type: "evenly_spaced" },
    };
    const now = Date.parse("2026-09-15T16:00:00Z");
    const progress = calendarProgress(
      calendarWindow(schedule, 2, now, timezone),
      0,
      2,
      now,
    );

    expect(progress.overdueCount).toBe(1);
    expect(
      evaluateSignal(
        {
          kind: "activity",
          target: { type: "schedule", schedule, targetCount: 2 },
        },
        now,
        0,
        progress,
      ).attention,
    ).toBe("due");
  });

  it("anchors every-other-week windows", () => {
    const schedule: CalendarSchedule = {
      rrule: "FREQ=WEEKLY;INTERVAL=2;WKST=MO",
      startDate: "2026-09-28",
      due: { type: "evenly_spaced" },
    };
    const window = calendarWindow(
      schedule,
      1,
      Date.parse("2026-10-06T16:00:00Z"),
      timezone,
    );

    expect(window).toMatchObject({
      startAt: Date.parse("2026-09-28T04:00:00Z"),
      endAt: Date.parse("2026-10-12T04:00:00Z"),
      deadlineAts: [Date.parse("2026-10-11T04:00:00Z")],
    });
  });

  it("supports a weekday deadline", () => {
    const schedule: CalendarSchedule = {
      rrule: "FREQ=WEEKLY;WKST=MO",
      startDate: "2026-09-28",
      due: { type: "weekdays", weekdays: [2] },
    };
    const now = Date.parse("2026-09-29T16:00:00Z");
    const progress = calendarProgress(
      calendarWindow(schedule, 1, now, timezone),
      0,
      1,
      now,
    );

    expect(progress).toMatchObject({
      requiredCountByNow: 1,
      overdueCount: 1,
      nextDueAt: Date.parse("2026-09-29T04:00:00Z"),
    });
  });

  it("can place a multi-member scorecard goal on one weekday", () => {
    const schedule: CalendarSchedule = {
      rrule: "FREQ=WEEKLY;WKST=MO",
      startDate: "2026-09-28",
      due: { type: "weekdays", weekdays: [2] },
    };
    const window = calendarWindow(
      schedule,
      3,
      Date.parse("2026-09-29T16:00:00Z"),
      timezone,
    );

    expect(window.deadlineAts).toEqual([
      Date.parse("2026-09-29T04:00:00Z"),
      Date.parse("2026-09-29T04:00:00Z"),
      Date.parse("2026-09-29T04:00:00Z"),
    ]);
  });

  it("rejects duplicate RRULE properties", () => {
    expect(() =>
      validateCalendarSchedule({
        rrule: "FREQ=DAILY;FREQ=WEEKLY",
        startDate: "2026-09-29",
        due: { type: "evenly_spaced" },
      }),
    ).toThrow("must not repeat rule properties");
  });
});
