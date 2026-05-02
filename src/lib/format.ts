/**
 * Display helpers for consistent formatting across the site.
 */

/** Format reading time — always shows "X min" */
export function formatTime(time: string | number): string {
  const str = String(time).trim();
  if (str.includes('min')) return str;
  return `${str} min`;
}

/** Format date as "16 April 2026" */
export function formatDate(dateStr: string): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const month = months[parseInt(parts[1], 10) - 1] ?? parts[1];
  const year = parts[0];
  return `${day} ${month} ${year}`;
}

/** Format Unix-ms timestamp as "14:43 UTC" (zero-padded, 24-hour). */
export function formatUtcTime(unixMs: number): string {
  const d = new Date(unixMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

/** Format Unix-ms timestamp as "Friday · 1 May 2026" (UTC). */
export function formatUtcLongDate(unixMs: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const d = new Date(unixMs);
  return `${days[d.getUTCDay()]} · ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Same as formatUtcLongDate but takes a YYYY-MM-DD string and treats it as UTC midnight. */
export function formatUtcLongDateFromIso(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const ms = Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  return formatUtcLongDate(ms);
}
