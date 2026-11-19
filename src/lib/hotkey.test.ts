import { describe, expect, it } from "vitest";
import { acceleratorFromEvent, keycaps } from "./hotkey";

const key = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("acceleratorFromEvent", () => {
  it("builds accelerators from modifiers and key codes", () => {
    expect(acceleratorFromEvent(key("KeyN", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+N");
    expect(acceleratorFromEvent(key("Digit1", { metaKey: true, shiftKey: true }))).toBe("Shift+Super+1");
    expect(acceleratorFromEvent(key("Space", { altKey: true }))).toBe("Alt+Space");
  });

  it("accepts bare function keys", () => {
    expect(acceleratorFromEvent(key("F9"))).toBe("F9");
  });

  it("rejects modifiers alone and combinations that would break typing", () => {
    expect(acceleratorFromEvent(key("ControlLeft", { ctrlKey: true }))).toBeNull();
    expect(acceleratorFromEvent(key("KeyN"))).toBeNull();
    expect(acceleratorFromEvent(key("KeyN", { shiftKey: true }))).toBeNull();
  });
});

describe("keycaps", () => {
  it("splits and humanises accelerators", () => {
    expect(keycaps("Ctrl+Alt+N")).toEqual(["Ctrl", "Alt", "N"]);
    expect(keycaps("Super+Space")).toEqual(["Win", "Пробел"]);
  });
});
