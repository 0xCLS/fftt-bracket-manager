/** Render a date-only event value in the spectator's US-English display format.
 * Use calendar components, not local Date parsing, so the day never changes by timezone. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatEventDate(value) {
  const date = String(value ?? '');
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return date;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1
      || calendarDate.getUTCDate() !== day) return date;
  return `${MONTHS[month - 1]} ${day}, ${parts[1]}`;
}
