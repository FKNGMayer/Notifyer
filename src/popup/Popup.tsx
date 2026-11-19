import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api, type PopupCard } from "../lib/api";
import { formatTime, popupTitle } from "../lib/format";
import "./popup.css";

const VISIBLE_MS = 15_000;
const LEAVE_MS = 220;

interface Card extends PopupCard {
  leaving?: boolean;
}

export default function Popup() {
  const [cards, setCards] = useState<Card[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const pull = useCallback(async () => {
    const fresh = await api.popupTakePending();
    if (fresh.length) setCards((current) => [...fresh.reverse(), ...current]);
  }, []);

  // Pull on mount too: pings sent before this window was ready are not lost.
  useEffect(() => {
    pull();
    const unlisten = getCurrentWebviewWindow().listen("popup-ping", pull);
    return () => {
      unlisten.then((u) => u());
    };
  }, [pull]);

  // The native window follows the stack height; 0 hides it.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => api.popupLayout(Math.ceil(el.offsetHeight)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const dismiss = useCallback((id: string) => {
    setCards((current) => current.map((c) => (c.id === id ? { ...c, leaving: true } : c)));
    setTimeout(() => setCards((current) => current.filter((c) => c.id !== id)), LEAVE_MS);
  }, []);

  const snooze = async (card: Card, minutes: number) => {
    await api.snooze(card.text, minutes);
    dismiss(card.id);
  };

  return (
    <div ref={rootRef} className="popup-stack">
      {cards.map((card) => {
        const now = card.offset === 0;
        return (
          <div key={card.id} className={`card ${now ? "is-now" : ""} ${card.leaving ? "is-leaving" : ""}`}>
            <div className="card-head">
              <span className="card-dot" />
              <span className="card-title">{popupTitle(card.offset)}</span>
              <span className="card-time">{formatTime(new Date(card.due))}</span>
            </div>
            <div className="card-text">{card.text}</div>
            <div className="card-actions">
              {now ? (
                <>
                  <button className="btn btn-primary" onClick={() => dismiss(card.id)}>
                    Готово
                  </button>
                  <button className="btn" onClick={() => snooze(card, 10)}>
                    +10 мин
                  </button>
                  <button className="btn" onClick={() => snooze(card, 60)}>
                    +1 час
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={() => dismiss(card.id)}>
                  Ок
                </button>
              )}
            </div>
            <div
              className="card-timer"
              style={{ animationDuration: `${VISIBLE_MS}ms` }}
              onAnimationEnd={() => dismiss(card.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
