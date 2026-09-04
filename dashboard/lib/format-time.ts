/**
 * Time formatting for the agent console.
 *
 * The backend stores everything in UTC with an offset, so `new Date(iso)`
 * lands on the agent's own local time without any conversion here.
 *
 * Two different jobs, deliberately formatted differently:
 *
 *  - In a list, an agent is asking "how stale is this?" — a relative
 *    phrase ("4 min ago") answers that instantly, while a clock time
 *    forces them to do the subtraction themselves.
 *  - Inside a chat, they're asking "when exactly was this said?" — there
 *    an actual clock time is what's wanted, since it may end up quoted
 *    back to a customer.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const elapsed = Date.now() - then;

  // A clock skew of a few seconds shouldn't produce "in 3 seconds".
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) {
    const mins = Math.floor(elapsed / MINUTE);
    return `${mins} min ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (elapsed < 2 * DAY) return "yesterday";
  if (elapsed < 7 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return `${days} days ago`;
  }
  // Past a week, "23 days ago" stops being useful — give the date.
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Clock time only, e.g. "4:12 PM" — used beside each message. */
export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Full date and time, for hover titles and ticket notes. */
export function fullTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Heading for a day's worth of messages. "Today" and "Yesterday" read
 * faster than a date when that's what the day actually is.
 */
export function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysApart = Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY);

  if (daysApart === 0) return "Today";
  if (daysApart === 1) return "Yesterday";
  if (daysApart < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/** True when two messages fall on different calendar days. */
export function isDifferentDay(a: string, b: string): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() !== second.getFullYear() ||
    first.getMonth() !== second.getMonth() ||
    first.getDate() !== second.getDate()
  );
}
