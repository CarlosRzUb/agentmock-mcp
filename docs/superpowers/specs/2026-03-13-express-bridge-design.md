# Express HTTP Bridge — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Scope:** MVP — Stripe-compatible REST API, single API key auth, no webhooks

---

## Overview

Implement a cloud-deployable Express HTTP server that exposes the existing mock Stripe state over HTTP. Developers point their Stripe SDK's `baseURL` at this server, set their API key to match `AGENTMOCK_API_KEY`, and get a drop-in replacement with zero code changes.

This is the core of the Pro tier. The MCP stdio server (free tier) is entirely unaffected.

---

## Architecture

### Files

| File | Status | Role |
|---|---|---|
| `src/bridge/express.ts` | New | Express app — middleware, routes, adapter helpers |
| `package.json` | Modified | Add `"bridge"` npm script |

### Design principle

The bridge is a **thin adapter layer**. It contains no business logic. Each route:
1. Parses the HTTP request body / query params
2. Calls the existing handler function from `src/tools/stripe.ts` or `src/tools/session.ts`
3. Unwraps the MCP-shaped result (`{ content, isError }`) into a proper HTTP response

All business logic (scenario injection, ID generation, store state) lives in the existing handler functions unchanged.

### Entry points

- **Free tier (MCP):** `npm run dev` → `src/server.ts` → stdio transport
- **Pro tier (HTTP):** `npm run bridge` → `src/bridge/express.ts` → HTTP on `PORT` env var (default `3000`)

---

## Middleware Stack

Applied globally in this order:

```ts
import cors from "cors";  // default import — works with esModuleInterop: true

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);
```

**`cors` import note:** `cors` is a CommonJS package. Import it as `import cors from "cors"`. This works because `tsconfig.json` has `"esModuleInterop": true`.

### `cors()`

Allows cross-origin requests. Required for browser-based tools and local development frontends hitting the cloud-hosted mock.

### Body parsing

Both `express.json()` and `express.urlencoded({ extended: true })` are registered. The Stripe SDK sends `application/x-www-form-urlencoded`; direct HTTP testing tools (curl, Postman) typically send JSON. Both are supported transparently via `Content-Type` header.

### Auth middleware

Validates `Authorization: Bearer <token>` against `process.env.AGENTMOCK_API_KEY`.

**Fail-fast on startup:** If `AGENTMOCK_API_KEY` is not set in the environment, the server logs an error to stderr and exits with code 1 before binding any port.

**Per-request validation:** If the header is missing or the token doesn't match:
```json
HTTP 401
{ "error": { "type": "invalid_request_error", "code": "api_key_invalid", "message": "No valid API key provided." } }
```

---

## Endpoint Surface

### Customers

| Method | Path | Handler |
|---|---|---|
| `POST` | `/v1/customers` | `stripeCreateCustomerHandler` |
| `GET` | `/v1/customers/:id` | `stripeRetrieveCustomerHandler` |
| `GET` | `/v1/customers` | `stripeListCustomersHandler` |

### Payment Intents

| Method | Path | Handler |
|---|---|---|
| `POST` | `/v1/payment_intents` | `stripeCreatePaymentIntentHandler` |
| `GET` | `/v1/payment_intents/:id` | `stripeRetrievePaymentIntentHandler` |
| `GET` | `/v1/payment_intents` | `stripeListPaymentIntentsHandler` |

### Subscriptions

| Method | Path | Handler |
|---|---|---|
| `POST` | `/v1/subscriptions` | `stripeCreateSubscriptionHandler` |
| `GET` | `/v1/subscriptions/:id` | `stripeRetrieveSubscriptionHandler` |
| `GET` | `/v1/subscriptions` | `stripeListSubscriptionsHandler` |

### AgentMock control endpoint

| Method | Path | Handler |
|---|---|---|
| `POST` | `/agentmock/scenario` | `setMockScenarioHandler` |

Outside the `/v1/` namespace to avoid collision with real Stripe paths. Auth middleware applies here too.

---

## Request Parameter Mapping

### POST body — field name normalisation

The Stripe SDK sends `customer` (not `customer_id`) for subscription and payment intent creation. The bridge must normalise these before passing to handlers:

| Route | Stripe SDK field | Handler input field | Action |
|---|---|---|---|
| `POST /v1/payment_intents` | `customer` | `customer_id` | Rename in route handler |
| `POST /v1/subscriptions` | `customer` | `customer_id` | Rename in route handler |
| `POST /v1/subscriptions` | _(Stripe uses `items[0][price]`)_ | `price_id` | Accept `price_id` directly — MVP simplification, does not parse Stripe's `items` array |

All other POST body fields (`email`, `name`, `amount`, `currency`, `payment_method`, `metadata`) are passed directly — names match.

Normalisation pattern in each affected route:

```ts
const input = { ...req.body };
if (input.customer) { input.customer_id = input.customer; delete input.customer; }
```

### GET query parameter mapping

| Query param | Handler input field | Notes |
|---|---|---|
| `?customer=<id>` | `customer_id` | Rename |
| `?limit=<n>` | `limit` | Coerce to integer (see below) |

### `limit` coercion

```ts
const rawLimit = req.query.limit;
const limit = rawLimit ? parseInt(rawLimit as string, 10) : undefined;
// Pass limit only if it is a valid finite integer
const handlerInput = { ..., ...(Number.isFinite(limit) ? { limit } : {}) };
```

`parseInt` on a non-numeric string returns `NaN`. Guard with `Number.isFinite()` — do not pass `NaN` to the handler (it causes `Array.slice(0, NaN)` which returns an empty array instead of the default 10).

---

## HTTP Status Code Mapping

The `httpStatusFor(payload)` helper is a standalone mapping inside `express.ts`. It does not consult the `SCENARIOS` registry (intentional — keeps the bridge self-contained). All error codes that can be produced by the existing handlers are enumerated explicitly:

```ts
// Precondition: only call this when result.isError is true.
// Calling it on a success payload will throw (payload.error is undefined).
function httpStatusFor(payload: { error: { type: string; code?: string } }): number {
  const { type, code } = payload.error;
  if (code === "resource_missing") return 404;
  if (type === "card_error") return 402;
  if (code === "rate_limit") return 429;
  if (code === "api_key_invalid") return 401;
  return 400; // invalid_request_error and any other
}
```

If a new scenario is added to the `SCENARIOS` registry with a novel HTTP status code, this mapping must be updated in sync. This is acceptable for the MVP scale.

---

## Adapter Pattern

### Stripe routes (JSON responses)

Every Stripe route (customers, payment intents, subscriptions) follows this shape:

```ts
router.post("/v1/customers", async (req, res) => {
  const result = await stripeCreateCustomerHandler(req.body);
  const data = JSON.parse(result.content[0].text);
  if (result.isError) {
    res.status(httpStatusFor(data)).json(data);
  } else {
    res.status(200).json(data);
  }
});
```

All Stripe handlers return valid JSON in `content[0].text` — this pattern is safe for all 9 Stripe routes.

### AgentMock scenario route (plain-text handler — specialised adapter)

`setMockScenarioHandler` returns **plain text strings**, not JSON (e.g. `"Active scenario set to: payment_declined"`). It never throws — all error conditions are returned as `{ isError: true }` results. The global error handler provides fallback coverage if an unexpected throw ever occurs; no per-route `try/catch` is needed. The `/agentmock/scenario` route uses a different adapter:

```ts
router.post("/agentmock/scenario", async (req, res) => {
  const result = await setMockScenarioHandler(req.body);
  if (result.isError) {
    res.status(400).json({
      error: {
        type: "invalid_request_error",
        message: result.content[0].text,
      },
    });
  } else {
    res.status(200).json({ message: result.content[0].text });
  }
});
```

**Request body schema:**

```json
{ "scenarioId": "payment_declined" }
```

`scenarioId` is camelCase (matches handler input). Omit the field entirely to clear the scenario.

**Response bodies:**

- Success (set): `200` `{ "message": "Active scenario set to: payment_declined" }`
- Success (clear): `200` `{ "message": "Active scenario cleared. Running in happy path mode." }`
- Error (invalid id): `400` `{ "error": { "type": "invalid_request_error", "message": "Unknown scenario: \"foo\". Valid values are: ..." } }`

---

## Global Error Handler

Catches any unhandled exception thrown by a route handler and returns a Stripe-shaped 500 response:

```ts
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
```

---

## npm Script

```json
"bridge": "tsx src/bridge/express.ts"
```

The server binds to `process.env.PORT ?? 3000` and logs `AgentMock HTTP bridge running on port <PORT>` to stderr on startup.

---

## Dependencies

- `express` — already in `package.json`
- `cors` — **must be installed**: `npm install cors && npm install -D @types/cors`

---

## Out of Scope (YAGNI)

- Webhook simulation (next spec)
- Multi-tenant API keys / per-user isolation
- Request logging / audit trail
- Rate limiting
- HTTPS termination (handled by Railway/Render reverse proxy)
- Shopify / Zendesk endpoints
- Pagination cursors
- Stripe `items[0][price]` array parsing for subscriptions (accept `price_id` directly)
