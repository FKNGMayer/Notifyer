import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Bell, Check, Clock } from "lucide-react";
import { api, type GlassRect, type PopupCard } from "../lib/api";
import { formatTime, inLabel } from "../lib/format";
import { layoutIslands, type IslandRect, type Notch } from "../lib/islands";
import { isMac } from "../lib/platform";
import "./popup.css";

// Geometry of the island stack, in CSS px. The glass panes follow these exact rects.
const WINDOW_WIDTH = 760;
// On macOS the window starts at the very top of the screen, over the menu bar.
const TOP = isMac ? 8 : 12;
const GAP = 10;
const SHADOW_ROOM = 40; // --shadow-room
const EVENT_HEIGHT = 60;
const HEADS_UP_HEIGHT = 42;
const LEAVE_MS = 380; // --glass-duration

interface Card extends PopupCard {
  leaving?: boolean;
}

interface Measure {
  /** Collapsed width. */
  base: number;
  /** Extra width revealed on hover (actions). */
  extra: number;
}

const isEvent = (card: PopupCard) => card.offset === 0;
const glassOf = ({ id, x, y, w, h, radius }: IslandRect): GlassRect => ({ id, x, y, w, h, radius });
const heightOf = (card: PopupCard) => (isEvent(card) ? EVENT_HEIGHT : HEADS_UP_HEIGHT);

export default function Popup() {
  const [cards, setCards] = useState<Card[]>([]);
  const [measures, setMeasures] = useState<Record<string, Measure>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(15);
  const [notch, setNotch] = useState<Notch | null>(null);
  /** Natural-width row and its always-visible part, per island. */
  const nodes = useRef<Record<string, { row: HTMLElement | null; main: HTMLElement | null }>>({});
  const lastRects = useRef<Record<string, IslandRect>>({});

  const pull = useCallback(async () => {
    // The notch is asked every time: the main screen may have changed since the last island.
    const [fresh, currentNotch] = await Promise.all([api.popupTakePending(), api.popupNotch()]);
    setNotch(currentNotch);
    // Islands are sized by measuring text, so the real font must be in place first.
    await document.fonts.load('600 15px "Inter Variable"').catch(() => undefined);
    if (fresh.length) setCards((current) => [...fresh.reverse(), ...current]);
  }, []);

  // Pull on mount too: pings sent before this window was ready are not lost.
  useEffect(() => {
    const loadSeconds = () => api.getSettings().then((s) => setSeconds(s.popupSeconds));
    loadSeconds();
    pull();
    const win = getCurrentWebviewWindow();
    const subscriptions = [win.listen("popup-ping", pull), win.listen("settings-changed", loadSeconds)];
    return () => subscriptions.forEach((p) => p.then((unlisten) => unlisten()));
  }, [pull]);

  // Measure natural widths of freshly added islands before they are painted.
  useLayoutEffect(() => {
    const missing = cards.filter((c) => !measures[c.id]);
    if (!missing.length) return;
    const next = { ...measures };
    for (const card of missing) {
      const n = nodes.current[card.id];
      if (!n?.main || !n.row) continue;
      // The row is max-content wide, so it includes every gap and padding of the actions.
      const base = Math.ceil(n.main.getBoundingClientRect().width);
      next[card.id] = { base, extra: Math.ceil(n.row.getBoundingClientRect().width) - base };
    }
    setMeasures(next);
  }, [cards, measures]);

  const rects = useMemo(() => {
    const result: Record<string, IslandRect> = {};
    // Leaving islands stay where they were while they slide out.
    for (const card of cards) {
      if (card.leaving && lastRects.current[card.id]) result[card.id] = lastRects.current[card.id];
    }
    const placed = cards.filter((c) => !c.leaving && measures[c.id]);
    const laid = layoutIslands(
      placed.map((c) => ({ id: c.id, height: heightOf(c), ...measures[c.id], open: hovered === c.id })),
      { width: WINDOW_WIDTH, top: TOP, gap: GAP, notch },
    );
    for (const rect of laid) result[rect.id] = rect;
    lastRects.current = { ...lastRects.current, ...result };
    return result;
  }, [cards, measures, hovered, notch]);

  // Drive the native side: window height and the glass panes under the islands.
  useEffect(() => {
    const all = Object.values(rects);
    const height = all.length ? Math.max(...all.map((r) => r.y + r.h)) + SHADOW_ROOM : 0;
    api.popupLayout(height);
    api.glassLayout(cards.filter((c) => !c.leaving && rects[c.id]).map((c) => glassOf(rects[c.id])));
  }, [rects, cards]);

  const dismiss = useCallback((id: string) => {
    setHovered((h) => (h === id ? null : h));
    setCards((current) => current.map((c) => (c.id === id ? { ...c, leaving: true } : c)));
    setTimeout(() => {
      setCards((current) => current.filter((c) => c.id !== id));
      delete nodes.current[id];
      delete lastRects.current[id];
    }, LEAVE_MS);
  }, []);

  /** Dismissed by the user, as opposed to the timer running out. */
  const close = (id: string) => {
    dismiss(id);
    api.releaseFocus();
  };

  const snooze = async (card: Card, minutes: number) => {
    await api.snooze(card.text, minutes);
    close(card.id);
  };

  return (
    <div className="stack">
      {cards.map((card) => {
        const rect = rects[card.id];
        const event = isEvent(card);
        const style = rect
          ? ({
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              paddingTop: rect.pad,
              paddingLeft: rect.inset,
              borderRadius: rect.notched ? `0 0 ${rect.radius}px ${rect.radius}px` : rect.radius,
              "--travel": `${-(rect.y + rect.h + 24)}px`,
            } as React.CSSProperties)
          : undefined;
        return (
          <div
            key={card.id}
            className={[
              "island",
              event ? "is-event" : "is-heads-up",
              rect ? "is-placed" : "",
              rect?.notched ? "is-notched" : "",
              card.leaving ? "is-leaving" : "",
              hovered === card.id ? "is-open" : "",
            ].join(" ")}
            style={style}
            onMouseEnter={() => !card.leaving && setHovered(card.id)}
            onMouseLeave={() => setHovered((h) => (h === card.id ? null : h))}
            onClick={() => close(card.id)}
          >
            <div
              className="island-row"
              ref={(el) => {
                nodes.current[card.id] = { main: nodes.current[card.id]?.main ?? null, row: el };
              }}
            >
              <div
                className="island-main"
                ref={(el) => {
                  nodes.current[card.id] = { row: nodes.current[card.id]?.row ?? null, main: el };
                }}
              >
                <span className="ring">
                  <svg className="ring-timer" viewBox="0 0 36 36" aria-hidden>
                    <circle className="ring-track" cx="18" cy="18" r="16" />
                    <circle
                      className="ring-progress"
                      cx="18"
                      cy="18"
                      r="16"
                      pathLength={100}
                      style={{ animationDuration: `${seconds}s` }}
                      onAnimationEnd={() => dismiss(card.id)}
                    />
                  </svg>
                  {event ? <Bell size={15} strokeWidth={2.4} /> : <Clock size={13} strokeWidth={2.4} />}
                </span>
                <span className="island-meta">{event ? formatTime(new Date(card.due)) : inLabel(card.offset)}</span>
                <span className="island-text">{card.text}</span>
              </div>
              {event && (
                <div className="island-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="island-button" onClick={() => snooze(card, 10)}>
                    10 мин
                  </button>
                  <button className="island-button" onClick={() => snooze(card, 60)}>
                    1 ч
                  </button>
                  <button className="island-done" aria-label="Готово" onClick={() => close(card.id)}>
                    <Check size={16} strokeWidth={2.8} />
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
