import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Bell, CalendarClock, Check, CornerDownLeft, FolderClosed, Settings2, X } from "lucide-react";
import AppGlyph from "../components/AppGlyph";
import { api, type Reminder, type Settings } from "../lib/api";
import { formatDay, formatDue, formatTime, offsetLabel } from "../lib/format";
import { parseDate } from "../lib/parseDate";
import "./quick.css";

const STANDARD_OFFSETS = [1440, 60, 30, 15, 5];
const UPCOMING_LIMIT = 4;

export default function Quick() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [text, setText] = useState("");
  const [ignoreDate, setIgnoreDate] = useState(false);
  const [offsets, setOffsets] = useState<number[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<Settings | null>(null);

  const refreshReminders = useCallback(() => {
    api.listReminders().then(setReminders);
  }, []);

  const loadSettings = useCallback(async () => {
    const s = await api.getSettings();
    settingsRef.current = s;
    setSettings(s);
    return s;
  }, []);

  const reset = useCallback(() => {
    setText("");
    setIgnoreDate(false);
    setOffsets(settingsRef.current?.defaultOffsets ?? []);
    setError(null);
    setSaved(false);
    setOpenCount((n) => n + 1);
    refreshReminders();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [refreshReminders]);

  useEffect(() => {
    loadSettings().then(reset);
    const win = getCurrentWebviewWindow();
    const subscriptions = [
      win.listen("quick-shown", reset),
      win.listen<string>("quick-prefill", ({ payload }) => setText(payload)),
      win.listen<string>("quick-add", ({ payload }) => {
        const p = parseDate(payload);
        api
          .saveEntry(p?.text ?? payload, p?.due.getTime() ?? null, p ? (settingsRef.current?.defaultOffsets ?? []) : [])
          .then(refreshReminders)
          .catch((e) => console.error(e));
      }),
      win.listen("reminders-changed", refreshReminders),
      win.listen("settings-changed", loadSettings),
      // Handing focus from the window to the webview fires a transient blur; hide only if it sticks.
      win.onFocusChanged(({ payload: focused }) => {
        if (focused) return;
        setTimeout(async () => {
          if (!(await win.isFocused())) api.hideQuick();
        }, 120);
      }),
    ];
    return () => subscriptions.forEach((p) => p.then((unlisten) => unlisten()));
  }, [loadSettings, reset, refreshReminders]);

  // Keep the native window exactly as tall as the content.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => api.quickResize(Math.ceil(el.offsetHeight)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const parsed = useMemo(() => (ignoreDate ? null : parseDate(text)), [text, ignoreDate]);
  const offsetChoices = useMemo(
    () => [...new Set([...STANDARD_OFFSETS, ...(settings?.defaultOffsets ?? [])])].sort((a, b) => b - a),
    [settings],
  );

  const focusInput = () => inputRef.current?.focus();

  const toggleOffset = (minutes: number) => {
    setOffsets((current) =>
      current.includes(minutes) ? current.filter((m) => m !== minutes) : [...current, minutes],
    );
    focusInput();
  };

  const save = async () => {
    if (!text.trim() || saved) return;
    try {
      await api.saveEntry(parsed?.text ?? text, parsed?.due.getTime() ?? null, parsed ? offsets : []);
      setSaved(true);
      setTimeout(() => api.hideQuick(), 420);
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
    focusInput();
  };

  const upcoming = !text && !saved ? reminders.slice(0, UPCOMING_LIMIT) : [];
  const mode = saved ? "saved" : parsed ? "reminder" : "note";

  return (
    <div ref={shellRef} className="shell">
      <div key={openCount} className={`panel quick pop is-${mode}`}>
        <div className="q-row">
          <div className="q-badge" aria-hidden>
            <span className="q-badge-icon" data-active={mode === "note"}>
              <AppGlyph size={17} />
            </span>
            <span className="q-badge-icon" data-active={mode === "reminder"}>
              <Bell size={16} strokeWidth={2.2} />
            </span>
            <span className="q-badge-icon" data-active={mode === "saved"}>
              <Check size={17} strokeWidth={2.6} />
            </span>
          </div>
          <input
            ref={inputRef}
            className="q-input"
            value={text}
            placeholder="Мысль или «завтра в 15 созвон»"
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
              if (!e.target.value) setIgnoreDate(false);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="q-return" data-visible={Boolean(text) && !saved} aria-hidden>
            <CornerDownLeft size={14} strokeWidth={2.2} />
          </span>
        </div>

        {parsed && !saved && (
          <div className="q-section q-when">
            <div className="q-due">
              <CalendarClock size={15} strokeWidth={2.2} />
              <span>{formatDue(parsed.due)}</span>
              <button
                className="q-due-clear"
                aria-label="Это не дата — сохранить как заметку"
                onClick={() => {
                  setIgnoreDate(true);
                  focusInput();
                }}
              >
                <X size={12} strokeWidth={2.6} />
              </button>
            </div>
            <div className="q-offsets" role="group" aria-label="Напомнить заранее">
              <span className="q-offsets-label">Заранее</span>
              {offsetChoices.map((m) => (
                <button
                  key={m}
                  className="token"
                  aria-pressed={offsets.includes(m)}
                  onClick={() => toggleOffset(m)}
                >
                  {offsetLabel(m)}
                </button>
              ))}
            </div>
          </div>
        )}

        {upcoming.length > 0 && (
          <div className="q-section q-upcoming">
            {upcoming.map((r) => {
              const due = new Date(r.due);
              return (
                <div key={r.id} className="q-item">
                  <span className="q-item-when">
                    <span className="q-item-day">{formatDay(due)}</span>
                    <span className="q-item-time">{formatTime(due)}</span>
                  </span>
                  <span className="q-item-text">{r.text}</span>
                  <button className="icon-button q-item-delete" aria-label="Удалить напоминание" onClick={() => removeReminder(r.id)}>
                    <X size={14} strokeWidth={2.4} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="q-footer">
          {error ? (
            <span className="q-error">{error}</span>
          ) : (
            <span className="q-target">
              <FolderClosed size={13} strokeWidth={2.2} />
              {settings?.vaultName ? (
                <>
                  {settings.vaultName}
                  <span className="q-target-sep">/</span>
                  {settings.inboxFolder}
                </>
              ) : (
                "Хранилище не выбрано"
              )}
            </span>
          )}
          <span className="q-hints">
            <span>
              <kbd>Enter</kbd> сохранить
            </span>
            <span>
              <kbd>Esc</kbd> закрыть
            </span>
            <button className="icon-button" aria-label="Настройки" onClick={() => api.openSettings()}>
              <Settings2 size={15} strokeWidth={2.2} />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
