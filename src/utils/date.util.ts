import { format, parseISO, isValid, addDays, subDays } from 'date-fns';

/**
 * Formats a date to ISO 8601 string (YYYY-MM-DD)
 */
export function toDateString(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'yyyy-MM-dd');
}

/**
 * Parses a date string to a Date object safely
 */
export function parseDateSafe(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const date = parseISO(dateStr);
  return isValid(date) ? date : null;
}

/**
 * Returns the start of today in UTC
 */
export function startOfToday(): Date {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now;
}

/**
 * Returns a date N days ago
 */
export function daysAgo(n: number): Date {
  return subDays(new Date(), n);
}

/**
 * Returns a date N days from now
 */
export function daysFromNow(n: number): Date {
  return addDays(new Date(), n);
}

/**
 * Returns a human-readable duration from milliseconds
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
