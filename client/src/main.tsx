import { createRoot } from "react-dom/client";
import App from "./App";
import OdooConnectionProvider from "./components/OdooConnectionStatus";
import ClerkVerificationApp from "./pages/ClerkVerificationPage";
import "./index.css";

const clerkRoute =
  window.location.pathname.startsWith("/clerk-verification") ||
  window.location.pathname.startsWith("/clerk-sign-in");

createRoot(document.getElementById("root")!).render(
  <OdooConnectionProvider><div style={{ paddingTop: "var(--odoo-status-height, 0px)" }}>{clerkRoute ? <ClerkVerificationApp /> : <App />}</div></OdooConnectionProvider>,
);
