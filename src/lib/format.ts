const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const time = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "сегодня, 15:00" / "завтра, 15:00" / "пт, 20 ноя, 15:00". */
export function formatDue(due: Date, now = new Date()): string {
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  if (days === 0) return `сегодня, ${time(due)}`;
  if (days === 1) return `завтра, ${time(due)}`;
  const year = due.getFullYear() !== now.getFullYear() ? ` ${due.getFullYear()}` : "";
  return `${WEEKDAYS[due.getDay()]}, ${due.getDate()} ${MONTHS[due.getMonth()]}${year}, ${time(due)}`;
}

/** Short chip label: "1 день", "1 ч", "30 мин". */
export function offsetLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} ${plural(d, "день", "дня", "дней")}`;
  }
  if (minutes % 60 === 0) return `${minutes / 60} ч`;
  return `${minutes} мин`;
}

/** Popup headline: "Сейчас" / "Через 30 минут" / "Через 1 час". */
export function popupTitle(offset: number): string {
  if (offset === 0) return "Сейчас";
  if (offset % 1440 === 0) {
    const d = offset / 1440;
    return `Через ${d} ${plural(d, "день", "дня", "дней")}`;
  }
  if (offset % 60 === 0) {
    const h = offset / 60;
    return `Через ${h} ${plural(h, "час", "часа", "часов")}`;
  }
  return `Через ${offset} ${plural(offset, "минуту", "минуты", "минут")}`;
}

export const formatTime = time;
