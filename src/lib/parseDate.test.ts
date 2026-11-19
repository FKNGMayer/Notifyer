import { describe, expect, it } from "vitest";
import { parseDate } from "./parseDate";

// Thursday, 19 Nov 2026, 20:30 local time.
const NOW = new Date(2026, 10, 19, 20, 30);

function at(y: number, m: number, d: number, h: number, min = 0) {
  return new Date(y, m - 1, d, h, min);
}

function parse(input: string) {
  return parseDate(input, NOW);
}

describe("parseDate", () => {
  it("returns null when there is no date", () => {
    expect(parse("купить молоко")).toBeNull();
    expect(parse("")).toBeNull();
  });

  it("parses day words with time and strips them from text", () => {
    const r = parse("завтра в 15:00 созвон с командой");
    expect(r?.due).toEqual(at(2026, 11, 20, 15));
    expect(r?.text).toBe("Созвон с командой");
  });

  it("parses day words without time as 09:00", () => {
    expect(parse("послезавтра встреча")?.due).toEqual(at(2026, 11, 21, 9));
    expect(parse("на завтра записаться")?.text).toBe("Записаться");
  });

  it("time only: today if still ahead, otherwise tomorrow", () => {
    expect(parse("созвон в 22")?.due).toEqual(at(2026, 11, 19, 22));
    expect(parse("созвон в 15")?.due).toEqual(at(2026, 11, 20, 15));
    expect(parse("созвон 21:45")?.due).toEqual(at(2026, 11, 19, 21, 45));
  });

  it("understands time-of-day modifiers", () => {
    expect(parse("завтра в 9 утра пробежка")?.due).toEqual(at(2026, 11, 20, 9));
    expect(parse("ужин 25 декабря в 7 вечера")?.due).toEqual(at(2026, 12, 25, 19));
    expect(parse("завтра в 3 дня")?.due).toEqual(at(2026, 11, 20, 15));
  });

  it("parses weekdays as the nearest future occurrence", () => {
    const r = parse("в пт 10:00 написать клиенту");
    expect(r?.due).toEqual(at(2026, 11, 20, 10));
    expect(r?.text).toBe("Написать клиенту");
    expect(parse("написать клиенту в пятницу")?.due).toEqual(at(2026, 11, 20, 9));
    expect(parse("в четверг в 21:00 x")?.due).toEqual(at(2026, 11, 19, 21));
    expect(parse("в четверг в 10 x")?.due).toEqual(at(2026, 11, 26, 10));
    expect(parse("во вторник отчёт")?.due).toEqual(at(2026, 11, 24, 9));
  });

  it("parses numeric dates and rolls past dates to next year", () => {
    expect(parse("20.11 в 15 созвон")?.due).toEqual(at(2026, 11, 20, 15));
    expect(parse("созвон 20.11")?.due).toEqual(at(2026, 11, 20, 9));
    expect(parse("1.01 поздравить")?.due).toEqual(at(2027, 1, 1, 9));
    expect(parse("5.03.2028 продлить домен")?.due).toEqual(at(2028, 3, 5, 9));
    expect(parse("31.02 что-то")).toBeNull();
  });

  it("parses textual dates", () => {
    expect(parse("20 ноя в 16:30 встреча")?.due).toEqual(at(2026, 11, 20, 16, 30));
    expect(parse("3 мая др")?.due).toEqual(at(2027, 5, 3, 9));
  });

  it("parses relative offsets", () => {
    expect(parse("через 10 мин выключить духовку")?.due).toEqual(at(2026, 11, 19, 20, 40));
    expect(parse("через 2 часа")?.due).toEqual(at(2026, 11, 19, 22, 30));
    expect(parse("через час позвонить")?.due).toEqual(at(2026, 11, 19, 21, 30));
    expect(parse("через полчаса")?.due).toEqual(at(2026, 11, 19, 21));
    expect(parse("через 3 дня в 12 оплатить")?.due).toEqual(at(2026, 11, 22, 12));
    expect(parse("через 10 мин выключить духовку")?.text).toBe("Выключить духовку");
  });

  it("keeps the original text when nothing but the date is left", () => {
    expect(parse("завтра в 15")?.text).toBe("завтра в 15");
  });
});
