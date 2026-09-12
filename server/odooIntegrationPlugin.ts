import express from "express";
import type { Plugin } from "vite";
import { odooIntegrationRouter } from "./odooIntegrationRoutes";

export function odooIntegrationPlugin(): Plugin {
  return { name: "ma2f-odoo-integration", configureServer(server) {
    const app = express();
    app.disable("x-powered-by");
    app.use("/api/odoo-integration", odooIntegrationRouter());
    server.middlewares.use(app);
  } };
}
