const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const formatTime = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Сегодня" / "Завтра" / "Пт, 20 ноя" (+ year when it differs). */
export function formatDay(due: Date, now = new Date()): string {
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  if (days === 0) return "Сегодня";
  if (days === 1) return "Завтра";
  if (days === 2) return "Послезавтра";
  const weekday = WEEKDAYS[due.getDay()];
  const year = due.getFullYear() !== now.getFullYear() ? ` ${due.getFullYear()}` : "";
  return `${weekday[0].toUpperCase()}${weekday.slice(1)}, ${due.getDate()} ${MONTHS[due.getMonth()]}${year}`;
}

/** "Завтра, 15:00". */
export function formatDue(due: Date, now = new Date()): string {
  return `${formatDay(due, now)}, ${formatTime(due)}`;
}

/** Chip label: "1 день", "1 ч", "30 мин". */
export function offsetLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} ${plural(d, "день", "дня", "дней")}`;
  }
  if (minutes % 60 === 0) return `${minutes / 60} ч`;
  return `${minutes} мин`;
}

/** "через 30 мин" / "через 1 ч" / "через 1 день". */
export function inLabel(minutes: number): string {
  return `через ${offsetLabel(minutes)}`;
}
