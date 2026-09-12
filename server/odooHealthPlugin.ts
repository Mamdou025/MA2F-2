import type { Plugin } from "vite";
import { odooHealthHandler } from "./odooHealth";

export function odooHealthPlugin(): Plugin {
  return {
    name: "ma2f-odoo-health",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method === "GET" && req.url?.split("?")[0] === "/api/odoo-health") {
          void odooHealthHandler(req, res);
        } else next();
      });
    },
  };
}
