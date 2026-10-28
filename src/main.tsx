import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { handleAuthCallback } from "./lib/auth";
import { configured, demo } from "./lib/supabase";
import { errorMessage } from "./lib/domain";
import "./styles.css";
async function start() {
  let authError = "";
  if (!demo && configured) {
    try {
      await handleAuthCallback();
    } catch (e) {
      authError = errorMessage(e);
      history.replaceState(null, "", window.location.pathname + "#/login");
    }
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App authError={authError} />
    </StrictMode>,
  );
}
void start();
