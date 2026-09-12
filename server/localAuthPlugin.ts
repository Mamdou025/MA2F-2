import express from "express";
import type { Plugin } from "vite";
import { localAuthRouter } from "./localAuthRoutes";

export function localAuthPlugin(): Plugin {
  return { name: "ma2f-local-auth", configureServer(server) {
    const app = express();
    app.use("/api/local-auth", localAuthRouter());
    server.middlewares.use(app);
  } };
}
