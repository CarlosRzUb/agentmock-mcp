import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { fileURLToPath } from "url";

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth middleware — reads AGENTMOCK_API_KEY at request time, not load time.
app.use((req: Request, res: Response, next: NextFunction) => {
  const key = process.env.AGENTMOCK_API_KEY;
  const authHeader = req.headers.authorization;
  if (!key || !authHeader || authHeader !== `Bearer ${key}`) {
    res.status(401).json({
      error: {
        type: "invalid_request_error",
        code: "api_key_invalid",
        message: "No valid API key provided.",
      },
    });
    return;
  }
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Precondition: only call this when result.isError is true.
// Calling it on a success payload will throw (payload.error is undefined).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function httpStatusFor(payload: { error: { type: string; code?: string } }): number {
  const { type, code } = payload.error;
  if (code === "resource_missing") return 404;
  if (type === "card_error") return 402;
  if (code === "rate_limit") return 429;
  if (code === "api_key_invalid") return 401;
  return 400;
}

// ─── Routes go here (Tasks 3-5) ───────────────────────────────────────────────
// IMPORTANT: all app.get/app.post route registrations must be added ABOVE the
// global error handler below. Routes registered after it will not have errors caught.

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled bridge error:", err);
  res.status(500).json({
    error: {
      type: "api_error",
      code: "server_error",
      message: "An unexpected error occurred.",
    },
  });
});

// ─── Server startup (only when run directly, not when imported by tests) ──────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const key = process.env.AGENTMOCK_API_KEY;
  if (!key) {
    console.error(
      "FATAL: AGENTMOCK_API_KEY environment variable is not set. Refusing to start."
    );
    process.exit(1);
  }
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.error(`AgentMock HTTP bridge running on port ${port}`);
  });
}

export { app };
