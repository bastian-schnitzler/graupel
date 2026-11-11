// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ConfigProvider } from "./config/index.ts";
import { initColorMode, migrateModelChainChoice } from "./state/index.ts";
import "./styles/tokens.css";
import "./styles/global.css";

initColorMode();
migrateModelChainChoice();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <ConfigProvider>
      <App />
    </ConfigProvider>
  </StrictMode>,
);
