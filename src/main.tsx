import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/inter";
import Quick from "./quick/Quick";
import Popup from "./popup/Popup";
import Settings from "./settings/Settings";
import "./styles/base.css";

// All windows load the same bundle; the window label decides what to render.
const label = getCurrentWindow().label;
document.documentElement.dataset.window = label;

const screens: Record<string, () => React.JSX.Element> = { quick: Quick, popup: Popup, settings: Settings };
const Screen = screens[label] ?? Quick;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Screen />
  </React.StrictMode>,
);
