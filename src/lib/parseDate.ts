// Russian natural-language date parser: "завтра в 15 созвон", "в пт 10:00", "через 2 часа".

export interface ParsedDate {
  due: Date;
  /** Input with the date phrase removed, capitalised. */
  text: string;
}

// \b does not work with Cyrillic, so word boundaries are spelled out.
const L = "(?<![\\p{L}\\d])";
const R = "(?![\\p{L}\\d])";
const re = (src: string) => new RegExp(L + src + R, "iu");

const RELATIVE = re(
  "через\\s+(?:(\\d+)\\s*)?(полчаса|минут[уы]?|мин|м|час(?:а|ов)?|ч|день|дня|дней|дн|д|недел[юиь]|нед)",
);
const DAY_WORD = re("(?:на\\s+)?(сегодня|завтра|послезавтра)");
const WEEKDAY = re(
  "(?:(?:во?|на)\\s+)?(понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье|пн|вт|ср|чт|пт|сб|вс)",
);
const NUMERIC_DATE = re("(?:на\\s+)?(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{4}|\\d{2}))?");
const TEXT_DATE = re(
  "(?:на\\s+)?(\\d{1,2})\\s+(янв\\p{L}*|фев\\p{L}*|мар\\p{L}*|апр\\p{L}*|ма[йя]|июн\\p{L}*|июл\\p{L}*|авг\\p{L}*|сен\\p{L}*|окт\\p{L}*|ноя\\p{L}*|дек\\p{L}*)",
);
const MODIFIER = "(?:\\s+(утра|дня|вечера|ночи))?";
const TIME_WITH_PREP = re(`(?:в|к)\\s+(\\d{1,2})(?::(\\d{2}))?(?![\\d./])${MODIFIER}`);
const TIME_BARE = re(`(\\d{1,2}):(\\d{2})${MODIFIER}`);

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const WEEKDAY_FULL = ["вос", "пон", "вто", "сре", "чет", "пят", "суб"];
const MONTHS = ["янв", "фев", "мар", "апр", "ма", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

interface Found {
  match: RegExpExecArray;
  start: number;
  end: number;
}

function find(input: string, pattern: RegExp, taken: [number, number][]): Found | null {
  const global = new RegExp(pattern.source, pattern.flags + "g");
  for (let m = global.exec(input); m; m = global.exec(input)) {
    const start = m.index;
    const end = start + m[0].length;
    if (!taken.some(([s, e]) => start < e && end > s)) {
      taken.push([start, end]);
      return { match: m, start, end };
    }
  }
  return null;
}

function weekdayIndex(word: string): number {
  const w = word.toLowerCase();
  const short = WEEKDAYS.indexOf(w);
  return short >= 0 ? short : WEEKDAY_FULL.indexOf(w.slice(0, 3));
}

function applyTime(date: Date, m: RegExpExecArray): boolean {
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  const modifier = m[3]?.toLowerCase();
  if (hours > 23 || minutes > 59) return false;
  if ((modifier === "вечера" || modifier === "дня") && hours < 12) hours += 12;
  if (modifier === "ночи" && hours === 12) hours = 0;
  date.setHours(hours, minutes, 0, 0);
  return true;
}

function relativeDelta(m: RegExpExecArray): { minutes: number } | { days: number } {
  const amount = m[1] ? Number(m[1]) : 1;
  const unit = m[2].toLowerCase();
  if (unit === "полчаса") return { minutes: 30 };
  if (unit.startsWith("м")) return { minutes: amount };
  if (unit.startsWith("ч")) return { minutes: amount * 60 };
  if (unit.startsWith("н")) return { days: amount * 7 };
  return { days: amount };
}

function cleanText(input: string, taken: [number, number][]): string {
  let text = input;
  for (const [s, e] of [...taken].sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, s) + " " + text.slice(e);
  }
  text = text.replace(/\s+/g, " ").replace(/^[\s,.:;—-]+|[\s,;:—-]+$/g, "").trim();
  if (!text) return input.trim();
  return text[0].toUpperCase() + text.slice(1);
}

export function parseDate(input: string, now: Date = new Date()): ParsedDate | null {
  const taken: [number, number][] = [];

  const relative = find(input, RELATIVE, taken);
  if (relative) {
    const delta = relativeDelta(relative.match);
    if ("minutes" in delta) {
      return {
        due: new Date(now.getTime() + delta.minutes * 60_000),
        text: cleanText(input, taken),
      };
    }
  }

  const numeric = find(input, NUMERIC_DATE, taken);
  const textual = numeric ? null : find(input, TEXT_DATE, taken);
  const dayWord = numeric || textual ? null : find(input, DAY_WORD, taken);
  const weekday = numeric || textual || dayWord ? null : find(input, WEEKDAY, taken);
  const time = find(input, TIME_WITH_PREP, taken) ?? find(input, TIME_BARE, taken);

  const hasDay = Boolean(relative || numeric || textual || dayWord || weekday);
  if (!hasDay && !time) return null;

  const due = new Date(now);
  due.setHours(9, 0, 0, 0);
  let explicitYear = false;

  if (relative) {
    due.setDate(due.getDate() + (relativeDelta(relative.match) as { days: number }).days);
  } else if (numeric || textual) {
    const m = (numeric ?? textual)!.match;
    const day = Number(m[1]);
    const month = numeric
      ? Number(m[2]) - 1
      : MONTHS.findIndex((p) => m[2].toLowerCase().startsWith(p));
    let year = due.getFullYear();
    if (numeric && m[3]) {
      year = Number(m[3].length === 2 ? "20" + m[3] : m[3]);
      explicitYear = true;
    }
    due.setFullYear(year, month, day);
    if (due.getMonth() !== month || due.getDate() !== day) return null;
  } else if (dayWord) {
    const word = dayWord.match[1].toLowerCase();
    due.setDate(due.getDate() + (word === "завтра" ? 1 : word === "послезавтра" ? 2 : 0));
  } else if (weekday) {
    const target = weekdayIndex(weekday.match[1]);
    due.setDate(due.getDate() + ((target - due.getDay() + 7) % 7));
  }

  if (time && !applyTime(due, time.match)) return null;

  // Roll forward ambiguous moments that already passed.
  if (due <= now) {
    if (weekday) due.setDate(due.getDate() + 7);
    else if ((numeric || textual) && !explicitYear) due.setFullYear(due.getFullYear() + 1);
    else if (!hasDay) due.setDate(due.getDate() + 1);
  }

  return { due, text: cleanText(input, taken) };
}
