import { resolveClerkProfile } from "./clerkProfile";
import {
  clerkMiddleware,
  clerkClient,
  getAuth,
} from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import type {
  ErrorRequestHandler,
  RequestHandler,
} from "express";
import { getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";

export const clerkVerificationAuth = clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(
    getClerkProxyHost(req) ?? "",
    process.env.CLERK_PUBLISHABLE_KEY,
  ),
}));

function sendJson(
  res: Parameters<RequestHandler>[1],
  statusCode: number,
  body: Record<string, unknown>,
) {
  res.statusCode = statusCode;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export const clerkVerificationHandler: RequestHandler = async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    return sendJson(res, 401, {
      authenticated: false,
      error: "Unauthorized",
    });
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    return sendJson(res, 200, {
      authenticated: true,
      ...resolveClerkProfile(userId, user),
    });
  } catch {
    return sendJson(res, 503, {
      authenticated: true, mapped: false, businessAccess: false,
      roles: [], directOdooAccess: false, error: "Identity lookup unavailable",
    });
  }
};

export const clerkVerificationErrorHandler: ErrorRequestHandler = (
  _error,
  _req,
  res,
  _next,
) => {
  return sendJson(res, 401, {
    authenticated: false,
    error: "Unauthorized",
  });
};