/** Timestamp helpers — mirrors app/client/encrypt.py */

const GMT7_OFFSET_MIN = 7 * 60;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

function formatTzColon(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = pad2(Math.floor(abs / 60));
  const mm = pad2(abs % 60);
  return `${sign}${hh}:${mm}`;
}

function formatTzNoColon(offsetMinutes: number): string {
  return formatTzColon(offsetMinutes).replace(":", "");
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

function wallClockInOffset(date: Date, offsetMinutes: number): WallClock {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
  };
}

function wallClockLocal(date: Date): WallClock {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    millisecond: date.getMilliseconds(),
  };
}

export interface JavaLikeTimestampOptions {
  /** Fixed offset from UTC in minutes (e.g. 420 for GMT+7). Omit for system local wall clock. */
  offsetMinutes?: number;
}

/**
 * Python java_like_timestamp — centisecond fraction, colon in TZ.
 * Pass offsetMinutes when mirroring Python datetimes with explicit tzinfo.
 */
export function javaLikeTimestamp(date: Date, options?: JavaLikeTimestampOptions): string {
  const offsetMinutes = options?.offsetMinutes;
  const wall =
    offsetMinutes === undefined ? wallClockLocal(date) : wallClockInOffset(date, offsetMinutes);
  const ms2 = pad2(Math.floor(wall.millisecond / 10));
  const tz =
    offsetMinutes === undefined
      ? formatTzColon(-date.getTimezoneOffset())
      : formatTzColon(offsetMinutes);
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}T${pad2(wall.hour)}:${pad2(wall.minute)}:${pad2(wall.second)}.${ms2}${tz}`;
}

/** Python ts_gmt7_without_colon — millisecond fraction, WIB (+0700) without colon. */
export function tsGmt7WithoutColon(date: Date): string {
  const wall = wallClockInOffset(date, GMT7_OFFSET_MIN);
  const millis = pad3(wall.millisecond);
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}T${pad2(wall.hour)}:${pad2(wall.minute)}:${pad2(wall.second)}.${millis}${formatTzNoColon(GMT7_OFFSET_MIN)}`;
}

/** CIAM refresh_token ax-request-at — 3-digit ms, always +0700. */
export function refreshAxRequestAtGmt7(date: Date): string {
  const wall = wallClockInOffset(date, GMT7_OFFSET_MIN);
  const millis = pad3(wall.millisecond);
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}T${pad2(wall.hour)}:${pad2(wall.minute)}:${pad2(wall.second)}.${millis}+0700`;
}

export function nowGmt7(): Date {
  return new Date();
}

/**
 * Unix timestamp for today's calendar date in WIB at the given wall-clock time.
 * Use this for user-facing schedules — Cloudflare Workers always run in UTC.
 */
export function wibTodayAtUnix(hour: number, minute: number, now = new Date()): number {
  const shifted = new Date(now.getTime() + GMT7_OFFSET_MIN * 60_000);
  const targetMs =
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      hour,
      minute,
      0,
      0,
    ) -
    GMT7_OFFSET_MIN * 60_000;
  return Math.floor(targetMs / 1000);
}

export { GMT7_OFFSET_MIN };