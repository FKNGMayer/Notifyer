import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Quick from "./quick/Quick";
import Popup from "./popup/Popup";
import "./styles/base.css";

// Both windows load the same bundle; the window label decides what to render.
const label = getCurrentWindow().label;
document.documentElement.dataset.window = label;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{label === "popup" ? <Popup /> : <Quick />}</React.StrictMode>,
);
