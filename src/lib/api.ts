import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  hotkey: string;
  vaultPath: string | null;
  vaultName: string | null;
  vaultAuto: boolean;
  vaultValid: boolean;
  inboxFolder: string;
  defaultOffsets: number[];
  popupSeconds: number;
  autostart: boolean;
}

export interface Reminder {
  id: string;
  text: string;
  due: number;
  offsets: number[];
}

export interface PopupCard {
  id: string;
  text: string;
  due: number;
  /** 0 for the event itself, otherwise minutes left. */
  offset: number;
}

/** A glass pane in CSS pixels relative to the window. */
export interface GlassRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  setHotkey: (hotkey: string) => invoke<Settings>("set_hotkey", { hotkey }),
  hotkeyRecording: (active: boolean) => invoke<void>("hotkey_recording", { active }),
  setVault: (path: string | null) => invoke<Settings>("set_vault", { path }),
  setInboxFolder: (folder: string) => invoke<Settings>("set_inbox_folder", { folder }),
  setDefaultOffsets: (offsets: number[]) => invoke<Settings>("set_default_offsets", { offsets }),
  setPopupSeconds: (seconds: number) => invoke<Settings>("set_popup_seconds", { seconds }),
  setAutostart: (enabled: boolean) => invoke<Settings>("set_autostart", { enabled }),
  openSettings: () => invoke<void>("open_settings"),
  hideSettings: () => invoke<void>("hide_settings"),

  saveEntry: (text: string, due: number | null, offsets: number[]) =>
    invoke<void>("save_entry", { text, due, offsets }),
  listReminders: () => invoke<Reminder[]>("list_reminders"),
  deleteReminder: (id: string) => invoke<void>("delete_reminder", { id }),
  snooze: (text: string, minutes: number) => invoke<void>("snooze", { text, minutes }),
  hideQuick: () => invoke<void>("hide_quick"),
  quickResize: (height: number) => invoke<void>("quick_resize", { height }),

  popupTakePending: () => invoke<PopupCard[]>("popup_take_pending"),
  popupLayout: (height: number) => invoke<void>("popup_layout", { height }),
  glassLayout: (rects: GlassRect[]) => invoke<void>("glass_layout", { rects }),
};
