// Converts keyboard events to global-shortcut accelerators ("Ctrl+Alt+N") and back to keycaps.

import { isMac } from "./platform";

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

type KeyLike = Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

/** Returns null while only modifiers are held or the combination is too easy to hit by accident. */
export function acceleratorFromEvent(e: KeyLike): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(
    Boolean,
  ) as string[];
  const isFunctionKey = /^F\d{1,2}$/.test(e.code);
  // Shift alone would steal ordinary typing.
  if (!isFunctionKey && !mods.some((m) => m !== "Shift")) return null;

  let key = e.code;
  if (/^Key[A-Z]$/.test(key)) key = key.slice(3);
  else if (/^Digit\d$/.test(key)) key = key.slice(5);
  return [...mods, key].join("+");
}

const KEYCAP_NAMES: Record<string, string> = {
  Super: "Win",
  Space: "Пробел",
  Enter: "Enter",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const MAC_KEYCAP_NAMES: Record<string, string> = {
  ...KEYCAP_NAMES,
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Super: "⌘",
  Enter: "↩",
};

export function keycaps(accelerator: string, mac = isMac): string[] {
  const names = mac ? MAC_KEYCAP_NAMES : KEYCAP_NAMES;
  return accelerator.split("+").map((part) => names[part] ?? part);
}
