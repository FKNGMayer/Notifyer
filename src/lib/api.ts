import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  defaultOffsets: number[];
  vaultName: string | null;
  inboxFolder: string;
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

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveEntry: (text: string, due: number | null, offsets: number[]) =>
    invoke<void>("save_entry", { text, due, offsets }),
  listReminders: () => invoke<Reminder[]>("list_reminders"),
  deleteReminder: (id: string) => invoke<void>("delete_reminder", { id }),
  snooze: (text: string, minutes: number) => invoke<void>("snooze", { text, minutes }),
  hideQuick: () => invoke<void>("hide_quick"),
  quickResize: (height: number) => invoke<void>("quick_resize", { height }),
  popupTakePending: () => invoke<PopupCard[]>("popup_take_pending"),
  popupLayout: (height: number) => invoke<void>("popup_layout", { height }),
  openConfig: () => invoke<void>("open_config"),
};
