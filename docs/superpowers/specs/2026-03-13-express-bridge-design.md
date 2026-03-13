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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);
```

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

### POST body fields

Stripe sends snake_case field names. Our handlers already accept snake_case inputs — no mapping needed. `req.body` is passed directly.

### GET query parameter mapping

Stripe list endpoints use `?customer=<id>` (not `customer_id`). The bridge normalises this:

| Query param | Handler input field |
|---|---|
| `?customer=<id>` | `customer_id` |
| `?limit=<n>` | `limit` (parsed as integer) |

`limit` must be coerced from string to number: `parseInt(req.query.limit as string, 10)` — passed only if present and a valid integer.

---

## HTTP Status Code Mapping

The adapter helper `httpStatusFor(payload)` maps error payloads to HTTP status codes:

| Condition | HTTP status |
|---|---|
| Happy path (`isError` absent) | `200` |
| `error.code === "resource_missing"` | `404` |
| `error.type === "card_error"` | `402` |
| `error.code === "rate_limit"` | `429` |
| `error.code === "api_key_invalid"` | `401` |
| All other `isError` | `400` |

---

## Adapter Pattern

Every route follows the same shape:

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

Error handling: if a handler throws unexpectedly, a global Express error handler catches it and returns `500` with a generic error payload.

---

## npm Script

```json
"bridge": "tsx src/bridge/express.ts"
```

The server binds to `process.env.PORT ?? 3000` and logs the port to stderr on startup.

---

## Dependencies

- `express` — already in `package.json`
- `cors` — needs to be installed (`npm install cors` + `npm install -D @types/cors`)

---

## Out of Scope (YAGNI)

- Webhook simulation (next spec)
- Multi-tenant API keys / per-user isolation
- Request logging / audit trail
- Rate limiting
- HTTPS termination (handled by Railway/Render reverse proxy)
- Shopify / Zendesk endpoints
- Pagination cursors
