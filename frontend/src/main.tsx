import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { apiOrigin } from "@/api/client";
import { getAccessToken } from "@/auth/tokens";
import { rootErrorOptions } from "@/log/errorHandlers";
import { installLogging } from "@/log/installLogging";

import { App } from "./App";
import "./styles/index.css";

// Before anything renders, so the first errors are caught too.
installLogging({ apiOrigin: apiOrigin(), getAccessToken });

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("index.html has no #root element");

createRoot(rootElement, rootErrorOptions).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
