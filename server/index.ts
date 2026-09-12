import express from "express";
import { localAuthRouter } from "./localAuthRoutes";
import { orderRouter } from "./orderRoutes";
import { odooHealthHandler } from "./odooHealth";
import { odooIntegrationRouter } from "./odooIntegrationRoutes";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import {
  clerkVerificationAuth,
  clerkVerificationErrorHandler,
  clerkVerificationHandler,
} from "./clerkVerification";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.use("/api/local-auth", localAuthRouter());
  app.use("/api/odoo-orders", orderRouter());
  app.get("/api/odoo-health", odooHealthHandler);
  app.use("/api/odoo-integration", odooIntegrationRouter());
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  app.get(
    "/api/clerk-verification",
    clerkVerificationAuth,
    clerkVerificationHandler,
    clerkVerificationErrorHandler,
  );
  app.get(["/healthz", "/api/healthz"], (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: "alive", service: "ma2f-web", dependenciesChecked: false });
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
