import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Plus, X } from "lucide-react";
import AppGlyph from "../components/AppGlyph";
import { api, type Settings as SettingsData } from "../lib/api";
import { offsetLabel } from "../lib/format";
import { acceleratorFromEvent, keycaps } from "../lib/hotkey";
import { isMac } from "../lib/platform";
import "./settings.css";

const OFFSET_PRESETS = [1440, 180, 60, 30, 15, 5];
const POPUP_SECONDS = [5, 10, 15, 30, 60];

export default function Settings() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const errorTimer = useRef<number | undefined>(undefined);
  const shellRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api.getSettings().then(setSettings), []);

  useEffect(() => {
    load();
    const win = getCurrentWebviewWindow();
    const subscriptions = [
      win.listen("settings-shown", () => {
        load();
        setOpenCount((n) => n + 1);
      }),
      win.listen("settings-changed", load),
    ];
    return () => subscriptions.forEach((p) => p.then((unlisten) => unlisten()));
  }, [load]);

  /** Runs a settings command, keeping the view in sync and surfacing errors. */
  const apply = async (action: Promise<SettingsData>) => {
    try {
      setSettings(await action);
      setError(null);
    } catch (e) {
      window.clearTimeout(errorTimer.current);
      setError(String(e));
      errorTimer.current = window.setTimeout(() => setError(null), 4500);
    }
  };

  const close = () => api.hideSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[data-recording='true']")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the native window exactly as tall as the content (it changes with warnings).
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => api.settingsResize(Math.ceil(el.offsetHeight)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [settings === null]);

  if (!settings) return <div className="shell" />;

  const pickVault = async () => {
    const path = await open({ directory: true, title: "Папка хранилища Obsidian", defaultPath: settings.vaultPath ?? undefined });
    if (typeof path === "string") apply(api.setVault(path));
  };

  const toggleOffset = (minutes: number) => {
    const current = settings.defaultOffsets;
    apply(
      api.setDefaultOffsets(
        current.includes(minutes) ? current.filter((m) => m !== minutes) : [...current, minutes],
      ),
    );
  };

  const offsetChoices = [...new Set([...OFFSET_PRESETS, ...settings.defaultOffsets])].sort((a, b) => b - a);

  return (
    <div ref={shellRef} className="shell">
      <div key={openCount} className="panel settings pop">
        <header className="s-titlebar" data-tauri-drag-region>
          <span className="s-title" data-tauri-drag-region>
            Настройки
          </span>
          <button className="s-close" aria-label="Закрыть" onClick={close}>
            <X size={13} strokeWidth={2.6} />
          </button>
        </header>

        <div className="s-content">
          <Section title="Быстрый ввод">
            <Row label="Горячая клавиша" hint="Открывает строку ввода из любого окна">
              <HotkeyRecorder value={settings.hotkey} onChange={(h) => apply(api.setHotkey(h))} />
            </Row>
          </Section>

          <Section title="Obsidian">
            <Row
              label="Хранилище"
              hint={settings.vaultPath ?? "Не найдено — выберите папку хранилища"}
              hintTitle={settings.vaultPath ?? undefined}
            >
              <div className="s-inline">
                {settings.vaultAuto && settings.vaultPath && <span className="s-badge">Авто</span>}
                {!settings.vaultAuto && (
                  <button className="s-link" onClick={() => apply(api.setVault(null))}>
                    Определять автоматически
                  </button>
                )}
                <button className="s-button" onClick={pickVault}>
                  Выбрать…
                </button>
              </div>
            </Row>
            {settings.vaultPath && !settings.vaultValid && (
              <div className="s-warning">
                <AlertTriangle size={14} strokeWidth={2.2} />
                В этой папке нет .obsidian — похоже, это не хранилище
              </div>
            )}
            <Row label="Папка для заметок" hint="Внутри хранилища, по файлу на каждый день">
              <FolderInput value={settings.inboxFolder} onCommit={(v) => apply(api.setInboxFolder(v))} />
            </Row>
          </Section>

          <Section title="Напоминания">
            <Row label="Напоминать заранее" hint="Включено по умолчанию у новых напоминаний" stacked>
              <div className="s-tokens">
                {offsetChoices.map((m) => (
                  <button
                    key={m}
                    className="token"
                    aria-pressed={settings.defaultOffsets.includes(m)}
                    onClick={() => toggleOffset(m)}
                  >
                    {offsetLabel(m)}
                  </button>
                ))}
                <CustomOffset onAdd={(m) => apply(api.setDefaultOffsets([...settings.defaultOffsets, m]))} />
              </div>
            </Row>
            <Row label="Показывать попап" hint="Пауза, пока курсор над ним">
              <Segmented
                options={POPUP_SECONDS.map((s) => ({ value: s, label: `${s} с` }))}
                value={settings.popupSeconds}
                onChange={(s) => apply(api.setPopupSeconds(s))}
              />
            </Row>
          </Section>

          <Section title="Система">
            <Row label={isMac ? "Открывать при входе в систему" : "Запускать вместе с Windows"}>
              <Switch checked={settings.autostart} onChange={(v) => apply(api.setAutostart(v))} />
            </Row>
          </Section>

          <footer className="s-footer">
            <span className="s-footer-mark">
              <AppGlyph size={14} />
            </span>
            Notifyer 0.2.0
          </footer>
        </div>

        <div className="s-toast" data-visible={Boolean(error)} role="alert">
          <AlertTriangle size={14} strokeWidth={2.2} />
          {error}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="s-section">
      <h2 className="s-section-title">{title}</h2>
      <div className="s-group">{children}</div>
    </section>
  );
}

function Row(props: {
  label: string;
  hint?: string;
  hintTitle?: string;
  stacked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`s-row ${props.stacked ? "is-stacked" : ""}`}>
      <div className="s-row-text">
        <div className="s-row-label">{props.label}</div>
        {props.hint && (
          <div className="s-row-hint" title={props.hintTitle}>
            {props.hint}
          </div>
        )}
      </div>
      <div className="s-row-control">{props.children}</div>
    </div>
  );
}

function HotkeyRecorder({ value, onChange }: { value: string; onChange: (accelerator: string) => void }) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    api.hotkeyRecording(true);
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setRecording(false);
        api.hotkeyRecording(false);
        return;
      }
      const accelerator = acceleratorFromEvent(e);
      if (accelerator) {
        setRecording(false);
        onChange(accelerator);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onChange]);

  return (
    <button
      className="s-hotkey"
      data-recording={recording}
      onClick={() => setRecording((r) => !r)}
      onBlur={() => {
        if (recording) {
          setRecording(false);
          api.hotkeyRecording(false);
        }
      }}
    >
      {recording ? (
        <span className="s-hotkey-prompt">Нажмите сочетание…</span>
      ) : (
        keycaps(value).map((k) => <kbd key={k}>{k}</kbd>)
      )}
    </button>
  );
}

function FolderInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() && draft !== value) onCommit(draft);
    else setDraft(value);
  };
  return (
    <input
      className="s-input"
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}

function CustomOffset({ onAdd }: { onAdd: (minutes: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!editing) {
    return (
      <button className="token token-add" aria-label="Своё значение" onClick={() => setEditing(true)}>
        <Plus size={14} strokeWidth={2.4} />
      </button>
    );
  }

  const done = () => {
    const minutes = Math.round(Number(draft.replace(",", ".")));
    if (minutes > 0) onAdd(minutes);
    setDraft("");
    setEditing(false);
  };

  return (
    <span className="token token-input">
      <input
        autoFocus
        inputMode="numeric"
        value={draft}
        placeholder="45"
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") done();
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft("");
            setEditing(false);
          }
        }}
      />
      мин
    </span>
  );
}

function Segmented<T extends string | number>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const index = Math.max(0, props.options.findIndex((o) => o.value === props.value));
  return (
    <div className="segmented" style={{ "--count": props.options.length, "--index": index } as React.CSSProperties}>
      <span className="segmented-thumb" />
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          className="segmented-option"
          aria-pressed={o.value === props.value}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button className="switch" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  );
}
