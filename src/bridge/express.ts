import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import {
  stripeCreateCustomerHandler,
  stripeRetrieveCustomerHandler,
  stripeListCustomersHandler,
  stripeCreatePaymentIntentHandler,
  stripeRetrievePaymentIntentHandler,
  stripeListPaymentIntentsHandler,
  stripeCreateSubscriptionHandler,
  stripeRetrieveSubscriptionHandler,
  stripeListSubscriptionsHandler,
} from "../tools/stripe.js";
import { setMockScenarioHandler } from "../tools/session.js";

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

// ─── Customers ────────────────────────────────────────────────────────────────

app.post("/v1/customers", async (req, res) => {
  const result = await stripeCreateCustomerHandler(req.body);
  const data = JSON.parse(result.content[0].text);
  if (result.isError) {
    res.status(httpStatusFor(data)).json(data);
  } else {
    res.status(200).json(data);
  }
});

app.get("/v1/customers/:id", async (req, res) => {
  const result = await stripeRetrieveCustomerHandler({ id: req.params.id });
  const data = JSON.parse(result.content[0].text);
  if (result.isError) {
    res.status(httpStatusFor(data)).json(data);
  } else {
    res.status(200).json(data);
  }
});

app.get("/v1/customers", async (req, res) => {
  const rawLimit = req.query.limit;
  const limit = rawLimit ? parseInt(rawLimit as string, 10) : undefined;
  const result = await stripeListCustomersHandler({
    ...(Number.isFinite(limit) ? { limit } : {}),
  });
  const data = JSON.parse(result.content[0].text);
  if (result.isError) {
    res.status(httpStatusFor(data)).json(data);
  } else {
    res.status(200).json(data);
  }
});

// ─── Payment Intents ──────────────────────────────────────────────────────────────

app.post("/v1/payment_intents", async (req, res) => {
  // Normalise Stripe SDK field name: customer → customer_id
  const body = { ...req.body };
  if (body.customer) { body.customer_id = body.customer; delete body.customer; }

  const result = await stripeCreatePaymentIntentHandler(body);
  const data = JSON.parse(result.content[0].text);
  if (result.isError) {
    res.status(httpStatusFor(data)).json(data);
  } else {
    res.status(200).json(data);
  }
});

app.get("/v1/payment_intents/:id", async (req, res) => {
  const result = await stripeRetrievePaymentIntentHandler({ id: req.params.id });
  const data = JSON.parse(result.content[0].text);
  if (result.isError) {
    res.status(httpStatusFor(data)).json(data);
  } else {
    res.status(200).json(data);
  }
});

app.get("/v1/payment_intents", async (req, res) => {
  const rawLimit = req.query.limit;
  const limit = rawLimit ? parseInt(rawLimit as string, 10) : undefined;
  const customer_id = req.query.customer as string | undefined;
  const result = await stripeListPaymentIntentsHandler({
    ...(customer_id ? { customer_id } : {}),
    ...(Number.isFinite(limit) ? { limit } : {}),
  });
  const data = JSON.parse(result.content[0].text);
  if (result.isError) {
    res.status(httpStatusFor(data)).json(data);
  } else {
    res.status(200).json(data);
  }
});

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
