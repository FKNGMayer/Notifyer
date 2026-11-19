import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api, type Reminder, type Settings } from "../lib/api";
import { formatDue, offsetLabel } from "../lib/format";
import { parseDate } from "../lib/parseDate";
import "./quick.css";

const STANDARD_OFFSETS = [1440, 60, 30, 15, 5];
const UPCOMING_LIMIT = 5;

export default function Quick() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [text, setText] = useState("");
  const [ignoreDate, setIgnoreDate] = useState(false);
  const [offsets, setOffsets] = useState<number[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshReminders = useCallback(() => {
    api.listReminders().then(setReminders);
  }, []);

  const reset = useCallback((defaults: number[]) => {
    setText("");
    setIgnoreDate(false);
    setOffsets(defaults);
    setError(null);
    setSaved(false);
    refreshReminders();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [refreshReminders]);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      reset(s.defaultOffsets);
    });
  }, [reset]);

  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const subscriptions = [
      win.listen("quick-shown", () => reset(settings?.defaultOffsets ?? [])),
      win.listen("reminders-changed", refreshReminders),
      win.onFocusChanged(({ payload: focused }) => {
        if (!focused) api.hideQuick();
      }),
    ];
    return () => subscriptions.forEach((p) => p.then((unlisten) => unlisten()));
  }, [reset, refreshReminders, settings]);

  // Keep the native window exactly as tall as the content.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => api.quickResize(Math.ceil(el.offsetHeight)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const parsed = useMemo(() => (ignoreDate ? null : parseDate(text)), [text, ignoreDate]);
  const offsetChoices = useMemo(
    () =>
      [...new Set([...STANDARD_OFFSETS, ...(settings?.defaultOffsets ?? [])])].sort((a, b) => b - a),
    [settings],
  );

  const toggleOffset = (minutes: number) =>
    setOffsets((current) =>
      current.includes(minutes) ? current.filter((m) => m !== minutes) : [...current, minutes],
    );

  const save = async () => {
    if (!text.trim() || saved) return;
    try {
      await api.saveEntry(parsed?.text ?? text, parsed?.due.getTime() ?? null, parsed ? offsets : []);
      setSaved(true);
      setTimeout(() => api.hideQuick(), 260);
    } catch (e) {
      setError(String(e));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      api.hideQuick();
    }
  };

  const removeReminder = async (id: string) => {
    await api.deleteReminder(id);
    refreshReminders();
  };

  const showUpcoming = !text && reminders.length > 0;

  return (
    <div ref={rootRef} className={`quick ${saved ? "is-saved" : ""}`}>
      <div className="quick-input-row">
        <span className={`quick-glyph ${parsed ? "is-reminder" : ""}`} aria-hidden>
          {saved ? "✓" : parsed ? "⏰" : "✦"}
        </span>
        <input
          ref={inputRef}
          className="quick-input"
          value={text}
          placeholder="Запиши мысль или «завтра в 15 созвон»…"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
            if (!e.target.value) setIgnoreDate(false);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd className="quick-enter">Enter</kbd>
      </div>

      {parsed && (
        <div className="quick-section quick-reminder">
          <div className="quick-due">
            <span className="quick-due-label">{formatDue(parsed.due)}</span>
            <button
              className="quick-due-clear"
              title="Это не дата — сохранить как обычную заметку"
              onClick={() => {
                setIgnoreDate(true);
                inputRef.current?.focus();
              }}
            >
              ✕
            </button>
          </div>
          <div className="quick-offsets">
            <span className="quick-offsets-label">напомнить за</span>
            {offsetChoices.map((m) => (
              <button
                key={m}
                className={`chip ${offsets.includes(m) ? "is-on" : ""}`}
                onClick={() => {
                  toggleOffset(m);
                  inputRef.current?.focus();
                }}
              >
                {offsetLabel(m)}
              </button>
            ))}
          </div>
        </div>
      )}

      {showUpcoming && (
        <div className="quick-section quick-upcoming">
          <div className="quick-caption">Ближайшие напоминания</div>
          {reminders.slice(0, UPCOMING_LIMIT).map((r) => (
            <div key={r.id} className="upcoming-row">
              <span className="upcoming-text">{r.text}</span>
              <span className="upcoming-due">{formatDue(new Date(r.due))}</span>
              <button className="upcoming-delete" title="Удалить" onClick={() => removeReminder(r.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="quick-footer">
        {error ? (
          <span className="quick-error">{error}</span>
        ) : (
          <span className="quick-target">
            {settings?.vaultName ? `${settings.vaultName} / ${settings.inboxFolder}` : "Хранилище не найдено"}
          </span>
        )}
        <span className="quick-hints">
          <kbd>Enter</kbd> сохранить <kbd>Esc</kbd> закрыть
          <button className="quick-config" title="Открыть конфиг" onClick={() => api.openConfig()}>
            ⚙
          </button>
        </span>
      </div>
    </div>
  );
}
