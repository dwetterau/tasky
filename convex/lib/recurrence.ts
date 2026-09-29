import { Temporal } from "@js-temporal/polyfill";
import { RRule, type Options } from "rrule";

export type CalendarUnit = "day" | "week" | "month";

export type CalendarSchedule = {
  rrule: string;
  startDate: string;
  due:
    | { type: "evenly_spaced" }
    | { type: "weekdays"; weekdays: number[] };
};

export type CalendarWindow = {
  period: CalendarUnit;
  startAt: number;
  endAt: number;
  deadlineAts: number[];
};

export type CalendarProgress = {
  period: CalendarUnit;
  startAt: number;
  endAt: number;
  completedCount: number;
  targetCount: number;
  remainingCount: number;
  requiredCountByNow: number;
  overdueCount: number;
  nextDueAt?: number;
};

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RRULE_LENGTH = 500;

function normalizedRRule(value: string): string {
  const trimmed = value.trim().toUpperCase();
  return trimmed.startsWith("RRULE:") ? trimmed.slice(6) : trimmed;
}

function cadenceOptions(rrule: string): Partial<Options> {
  const normalized = normalizedRRule(rrule);
  if (!normalized || normalized.length > MAX_RRULE_LENGTH) {
    throw new Error("schedule.rrule must be between 1 and 500 characters");
  }
  if (/[\r\n]|DTSTART|TZID/.test(normalized)) {
    throw new Error(
      "schedule.rrule must contain only the RRULE value; DTSTART and timezone are stored separately",
    );
  }
  const ruleParts = normalized.split(";").map((part) => part.split("=", 1)[0]);
  if (
    ruleParts.some((part) => part.length === 0) ||
    new Set(ruleParts).size !== ruleParts.length
  ) {
    throw new Error("schedule.rrule must not repeat rule properties");
  }
  let options: Partial<Options>;
  try {
    options = RRule.parseString(normalized);
  } catch {
    throw new Error("schedule.rrule must be a valid RRULE");
  }
  if (
    options.freq !== RRule.DAILY &&
    options.freq !== RRule.WEEKLY &&
    options.freq !== RRule.MONTHLY
  ) {
    throw new Error("schedule.rrule supports only DAILY, WEEKLY, or MONTHLY");
  }
  const unsupported = [
    options.dtstart,
    options.tzid,
    options.count,
    options.until,
    options.bysetpos,
    options.bymonth,
    options.bymonthday,
    options.byyearday,
    options.byweekno,
    options.byweekday,
    options.bynweekday,
    options.byhour,
    options.byminute,
    options.bysecond,
    options.byeaster,
  ];
  if (unsupported.some((value) => value !== undefined && value !== null)) {
    throw new Error(
      "schedule.rrule may only use FREQ, INTERVAL, and WKST; Tasky stores due-day rules separately",
    );
  }
  const interval = options.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 100) {
    throw new Error("schedule.rrule INTERVAL must be an integer from 1 to 100");
  }
  if (
    options.freq === RRule.WEEKLY &&
    options.wkst !== undefined &&
    options.wkst !== null &&
    String(options.wkst) !== "MO"
  ) {
    throw new Error("Weekly schedules must use WKST=MO");
  }
  return options;
}

export function validateTimezone(timezone: string): void {
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timezone);
  } catch {
    throw new Error("timezone must be a valid IANA timezone");
  }
}

export function validateCalendarSchedule(schedule: CalendarSchedule): void {
  const options = cadenceOptions(schedule.rrule);
  if (!LOCAL_DATE.test(schedule.startDate)) {
    throw new Error("schedule.startDate must use YYYY-MM-DD");
  }
  let start: Temporal.PlainDate;
  try {
    start = Temporal.PlainDate.from(schedule.startDate);
  } catch {
    throw new Error("schedule.startDate must be a valid local date");
  }
  if (options.freq === RRule.WEEKLY && start.dayOfWeek !== 1) {
    throw new Error("Weekly schedule.startDate must be a Monday");
  }
  if (options.freq === RRule.MONTHLY && start.day !== 1) {
    throw new Error("Monthly schedule.startDate must be the first of the month");
  }
  if (schedule.due.type === "weekdays") {
    if (options.freq !== RRule.WEEKLY || (options.interval ?? 1) !== 1) {
      throw new Error("Weekday deadlines require an every-week schedule");
    }
    if (
      schedule.due.weekdays.length === 0 ||
      new Set(schedule.due.weekdays).size !== schedule.due.weekdays.length ||
      schedule.due.weekdays.some(
        (weekday) =>
          !Number.isInteger(weekday) || weekday < 1 || weekday > 7,
      )
    ) {
      throw new Error(
        "schedule.due.weekdays must contain unique ISO weekdays from 1 to 7",
      );
    }
  }
}

export function legacyCalendarSchedule(
  period: CalendarUnit,
): CalendarSchedule {
  if (period === "day") {
    return {
      rrule: "FREQ=DAILY",
      startDate: "1970-01-01",
      due: { type: "evenly_spaced" },
    };
  }
  if (period === "week") {
    return {
      rrule: "FREQ=WEEKLY;WKST=MO",
      startDate: "1970-01-05",
      due: { type: "evenly_spaced" },
    };
  }
  return {
    rrule: "FREQ=MONTHLY",
    startDate: "1970-01-01",
    due: { type: "evenly_spaced" },
  };
}

function cadence(schedule: CalendarSchedule): {
  period: CalendarUnit;
  interval: number;
} {
  const options = cadenceOptions(schedule.rrule);
  const period =
    options.freq === RRule.DAILY
      ? "day"
      : options.freq === RRule.WEEKLY
        ? "week"
        : "month";
  return { period, interval: options.interval ?? 1 };
}

function currentWindowDates(
  schedule: CalendarSchedule,
  now: number,
  timezone: string,
): {
  period: CalendarUnit;
  start: Temporal.PlainDate;
  end: Temporal.PlainDate;
} {
  validateCalendarSchedule(schedule);
  validateTimezone(timezone);
  const { period, interval } = cadence(schedule);
  const anchor = Temporal.PlainDate.from(schedule.startDate);
  const today = Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(timezone)
    .toPlainDate();

  if (Temporal.PlainDate.compare(today, anchor) < 0) {
    const end =
      period === "day"
        ? anchor.add({ days: interval })
        : period === "week"
          ? anchor.add({ weeks: interval })
          : anchor.add({ months: interval });
    return { period, start: anchor, end };
  }

  if (period === "month") {
    const months =
      (today.year - anchor.year) * 12 + (today.month - anchor.month);
    const start = anchor.add({
      months: Math.floor(months / interval) * interval,
    });
    return { period, start, end: start.add({ months: interval }) };
  }

  const days = anchor.until(today, { largestUnit: "days" }).days;
  const windowDays = period === "week" ? interval * 7 : interval;
  const start = anchor.add({
    days: Math.floor(days / windowDays) * windowDays,
  });
  return { period, start, end: start.add({ days: windowDays }) };
}

function startOfDay(date: Temporal.PlainDate, timezone: string): number {
  return date.toZonedDateTime(timezone).epochMilliseconds;
}

function evenlySpacedDeadlines(
  start: Temporal.PlainDate,
  end: Temporal.PlainDate,
  targetCount: number,
  timezone: string,
): number[] {
  if (targetCount <= 0) return [];
  const totalDays = start.until(end, { largestUnit: "days" }).days;
  return Array.from({ length: targetCount }, (_, index) => {
    const dayOffset =
      Math.ceil((totalDays * (index + 1)) / targetCount) - 1;
    return startOfDay(start.add({ days: Math.max(0, dayOffset) }), timezone);
  });
}

export function calendarWindow(
  schedule: CalendarSchedule,
  targetCount: number,
  now: number,
  timezone: string,
): CalendarWindow {
  if (!Number.isInteger(targetCount) || targetCount < 0) {
    throw new Error("targetCount must be a non-negative integer");
  }
  const { period, start, end } = currentWindowDates(schedule, now, timezone);
  const deadlineAts =
    schedule.due.type === "weekdays"
      ? schedule.due.weekdays
          .slice()
          .sort((left, right) => left - right)
          .map((weekday) => startOfDay(start.add({ days: weekday - 1 }), timezone))
      : evenlySpacedDeadlines(start, end, targetCount, timezone);
  const targetDeadlines =
    schedule.due.type === "weekdays" &&
    targetCount > 0 &&
    deadlineAts.length > 0 &&
    targetCount !== deadlineAts.length
      ? Array.from({ length: targetCount }, (_, index) => {
          const deadlineIndex =
            Math.ceil(((index + 1) * deadlineAts.length) / targetCount) - 1;
          return deadlineAts[deadlineIndex]!;
        })
      : deadlineAts;
  return {
    period,
    startAt: startOfDay(start, timezone),
    endAt: startOfDay(end, timezone),
    deadlineAts: targetDeadlines,
  };
}

export function calendarProgress(
  window: CalendarWindow,
  completedCount: number,
  targetCount: number,
  now: number,
): CalendarProgress {
  const safeCompletedCount = Math.max(0, completedCount);
  const requiredCountByNow = window.deadlineAts.filter(
    (deadlineAt) => deadlineAt <= now,
  ).length;
  const nextDueAt =
    safeCompletedCount < targetCount
      ? window.deadlineAts[Math.min(safeCompletedCount, targetCount - 1)]
      : undefined;
  return {
    period: window.period,
    startAt: window.startAt,
    endAt: window.endAt,
    completedCount: safeCompletedCount,
    targetCount,
    remainingCount: Math.max(0, targetCount - safeCompletedCount),
    requiredCountByNow,
    overdueCount: Math.max(0, requiredCountByNow - safeCompletedCount),
    nextDueAt,
  };
}

export function localDateFor(
  timestamp: number,
  timezone: string,
): string {
  validateTimezone(timezone);
  return Temporal.Instant.fromEpochMilliseconds(timestamp)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}

export function startDateForUnit(
  unit: CalendarUnit,
  timestamp: number,
  timezone: string,
): string {
  validateTimezone(timezone);
  const today = Temporal.Instant.fromEpochMilliseconds(timestamp)
    .toZonedDateTimeISO(timezone)
    .toPlainDate();
  if (unit === "week") {
    return today.subtract({ days: today.dayOfWeek - 1 }).toString();
  }
  if (unit === "month") {
    return today.with({ day: 1 }).toString();
  }
  return today.toString();
}
