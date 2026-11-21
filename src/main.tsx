import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/inter";
// Shared styles first: component stylesheets override them.
import "./styles/base.css";
import Quick from "./quick/Quick";
import Popup from "./popup/Popup";
import Settings from "./settings/Settings";
import { isMac } from "./lib/platform";

// All windows load the same bundle; the window label decides what to render.
const label = getCurrentWindow().label;
document.documentElement.dataset.window = label;
document.documentElement.dataset.platform = isMac ? "mac" : "windows";

const screens: Record<string, () => React.JSX.Element> = { quick: Quick, popup: Popup, settings: Settings };
const Screen = screens[label] ?? Quick;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Screen />
  </React.StrictMode>,
);
