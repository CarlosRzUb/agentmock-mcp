# Stripe Mock — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Scope:** MVP — core happy path + scenario-driven error simulation

---

## Overview

Implement the mock Stripe integration for AgentMock MCP. The killer feature is **realistic error simulation**: AI agents encounter Stripe-shaped error payloads (card declined, rate limit, etc.) so developers can test their agent's error-handling logic without touching production.

The foundation (`src/scenarios/index.ts`) is already implemented. This spec covers the three remaining pieces: session tools, Stripe tools, and server wiring.

---

## Architecture

### Files

| File | Status | Role |
|---|---|---|
| `src/scenarios/index.ts` | Done | Scenario registry + `resolveScenario()` |
| `src/tools/session.ts` | New | `set_mock_scenario` tool |
| `src/tools/stripe.ts` | New | 9 Stripe tools |
| `src/server.ts` | Modified | Import + register both tool files |

### Registration Pattern

Each tool file exports a single registration function:

```ts
export function registerSessionTools(server: McpServer): void { ... }
export function registerStripeTools(server: McpServer): void { ... }
```

`server.ts` calls both at startup, remaining a thin orchestrator with no tool logic of its own.

### Error Response Shape

When a scenario fires, tools return the MCP standard error format:

```ts
{
  content: [{ type: "text", text: JSON.stringify(stripeErrorPayload) }],
  isError: true
}
```

`isError: true` signals a tool-level failure to the agent — identical to what it would receive from the real Stripe API.

---

## Scenario Injection — Two Layers

### Layer 1 — Inline token (Payment Intent tools only)

The `payment_method` parameter of `stripe_create_payment_intent` accepts Stripe-style test tokens:

| Token | Scenario |
|---|---|
| `tok_chargeDeclined` | `payment_declined` |
| `tok_chargeDeclinedInsufficientFunds` | `insufficient_funds` |
| `tok_chargeDeclinedIncorrectCvc` | `invalid_cvc` |
| `tok_chargeDeclinedExpiredCard` | `expired_card` |

Layer 1 takes priority over Layer 2.

**Token pass-through behaviour:** `resolveScenario` falls back to using the raw token value as a scenario key when it is not found in `TOKEN_ALIASES`. This means any raw scenario key works as an inline token — including the four card-error keys (`payment_declined`, `insufficient_funds`, etc.) and also `rate_limit_exceeded`. Passing `payment_method: "rate_limit_exceeded"` will fire a rate-limit error via Layer 1. This is **intentional and a developer power-user feature** — it requires no guard. Implementers must not add validation that restricts `payment_method` to only the four listed test tokens.

If the resolved key is not found in `SCENARIOS` (e.g. a real payment method ID like `"pm_card_visa"`), Layer 1 silently skips and Layer 2 proceeds normally. No error is raised for unrecognised tokens.

### Layer 2 — Session scenario (all tools)

If a session scenario is active, every tool checks it before executing. A single `rate_limit_exceeded` scenario blocks the entire mock API, just like the real Stripe.

**Scenario check pattern** — top of every handler:

Payment Intent tools (Layer 1 + Layer 2):
```ts
const session = store.getSession();
const err = resolveScenario(input.payment_method, session?.scenarioId);
if (err) return { content: [{ type: "text", text: JSON.stringify(err) }], isError: true };
```

All other tools (Layer 2 only) — pass `undefined` explicitly so `scenarioId` maps to the correct positional parameter:
```ts
const session = store.getSession();
const err = resolveScenario(undefined, session?.scenarioId);
if (err) return { content: [{ type: "text", text: JSON.stringify(err) }], isError: true };
```

---

## Tools

### `src/tools/session.ts`

#### `set_mock_scenario`

Sets or clears the active session scenario.

**Zod schema:** `scenarioId` must be typed as `z.string().optional()`. Do NOT use `z.enum([...])` — enum validation must be done inside the handler body so the error response can be formatted as `isError: true` with a message listing valid values. Zod enum parse failures surface at the protocol level before the handler runs, bypassing the controlled error format.

**Parameters:**
- `scenarioId` (optional string) — one of: `payment_declined`, `insufficient_funds`, `invalid_cvc`, `expired_card`, `rate_limit_exceeded`. Omit entirely to reset to happy path. Passing `null` is not accepted by the underlying API (`startSession(scenarioId?: string)`) — Zod must mark the field as `.optional()`, not `.nullable()`.

**Behavior:**
- On unrecognised `scenarioId`: return `isError: true` with a message listing all valid scenario IDs from `Object.keys(SCENARIOS)`.
- On valid `scenarioId`: call `store.startSession(scenarioId)`.
- On omitted `scenarioId`: call `store.startSession()` (no argument) to create a new session with no active scenario.
- `store.startSession()` only overwrites `this.data.session` — it does NOT wipe stored entities (customers, payment intents, subscriptions). All existing mock data is preserved. Only `store.reset()` wipes entity data, and a `reset` tool is deferred to a future spec.
- On success: return a confirmation message. Use consistent phrasing:
  - With scenario: `"Active scenario set to: payment_declined"` (substitute the actual ID)
  - Without scenario: `"Active scenario cleared. Running in happy path mode."`

---

### `src/tools/stripe.ts`

#### Customers (Layer 2 only)

| Tool | Required params | Optional params |
|---|---|---|
| `stripe_create_customer` | `email`, `name` | `metadata` |
| `stripe_retrieve_customer` | `id` | — |
| `stripe_list_customers` | — | `limit` |

#### Payment Intents (Layer 1 + Layer 2)

| Tool | Required params | Optional params |
|---|---|---|
| `stripe_create_payment_intent` | `amount` (cents), `currency` | `payment_method`, `customer_id`, `metadata` |
| `stripe_retrieve_payment_intent` | `id` | — |
| `stripe_list_payment_intents` | — | `customer_id`, `limit` |

#### Subscriptions (Layer 2 only)

| Tool | Required params | Optional params |
|---|---|---|
| `stripe_create_subscription` | `customer_id`, `price_id` | `metadata` |
| `stripe_retrieve_subscription` | `id` | — |
| `stripe_list_subscriptions` | — | `customer_id`, `limit` |

**`limit` Zod schema for all list tools:** `z.number().int().min(1).max(100).default(10)`. Out-of-range values are rejected by Zod at the protocol level (not a handler-level `isError: true`). This is acceptable — it is a caller error, not a Stripe API error.

---

## Data Flow & Fake Data

### Happy path

```
tool called → scenario check (null) → build entity with faker + newId → store.stripe.X.set(id, entity) → return JSON
```

### Entity defaults

**`stripe_create_customer`**
- `id`: `newId.stripeCustomer()`
- `created`: `Math.floor(Date.now() / 1000)` (Unix timestamp, matches Stripe format)
- `metadata`: caller-supplied or `{}`
- All other fields supplied by caller; faker not needed (`email` and `name` are required params)

**`stripe_create_payment_intent`**
- If a scenario fires, return the error immediately — **no entity is created or stored**.
- For happy-path calls:
  - `id`: `newId.stripePaymentIntent()`
  - `status`: `"succeeded"` if `payment_method` was provided; `"requires_payment_method"` if `payment_method` was absent
  - `created`: Unix timestamp
- `payment_method` is intentionally **not stored** on the entity — `StripePaymentIntent` in `store.ts` has no `paymentMethod` field. This is a known MVP limitation. The field is consumed only for scenario injection and discarded.

**`stripe_create_subscription`**
- `id`: `newId.stripeSubscription()`
- `status`: `"active"`
- `currentPeriodEnd`: Unix timestamp 30 days from now (`Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60`)
- `created`: Unix timestamp
- `metadata`: caller-supplied or `{}`
- `price_id` is accepted as an **opaque string** — no price catalog exists in this MVP; no validation is performed beyond presence. (`newId.stripePrice()` exists in `store.ts` but is not used here — the caller always supplies `price_id`.)

---

## Response Field Naming

Tool responses return the raw stored entity shape, which uses **camelCase**. This is an intentional deviation from Stripe's real snake_case API — it keeps the implementation simple for the MVP and avoids a serialization/mapping layer.

Example deviations developers will see:

| Real Stripe (snake_case) | AgentMock (camelCase) |
|---|---|
| `customer` | `customerId` |
| `current_period_end` | `currentPeriodEnd` |
| `price_id` (on subscription) | `priceId` |

---

## List Tool Response Envelope

All list tools return:

```ts
{ data: StripeEntity[], hasMore: false }
```

`hasMore` (camelCase, consistent with the camelCase-deviation policy) is always `false` in this MVP (no cursor pagination). This applies to both empty and non-empty results — the empty case `{ data: [], hasMore: false }` uses the same envelope.

---

## Edge Cases

| Situation | Response |
|---|---|
| `stripe_retrieve_*` with unknown ID | `{ error: { type: "invalid_request_error", code: "resource_missing", message: "No such resource: '<id>'" } }`, `isError: true` |
| `stripe_create_subscription` with unknown `customer_id` | `{ error: { type: "invalid_request_error", code: "resource_missing", message: "No such customer: '<id>'" } }`, `isError: true` |
| `stripe_create_payment_intent` with unknown `customer_id` | Store `customerId` as-is without validating it exists — MVP simplification, no error returned |
| `stripe_create_payment_intent` with `payment_method` that is not a test token or scenario key (e.g. `"pm_card_visa"`) | Layer 1 silently skips, Layer 2 proceeds. No error. `status` is `"succeeded"` (payment_method is non-null). |
| `stripe_list_*` with no data | `{ data: [], hasMore: false }` — empty list, not an error |
| `set_mock_scenario` with unknown `scenarioId` | `isError: true`, message lists valid scenario IDs from `Object.keys(SCENARIOS)` |
| `limit` outside 1–100 | Rejected by Zod at protocol level (not a handler `isError: true`) |

---

## Out of Scope (YAGNI)

- Payment method confirmation flow (`stripe_confirm_payment_intent`)
- Update / delete / cancel operations
- Pagination cursors (only `limit`)
- Webhook simulation
- `reset` tool (deferred to future spec)
- Shopify / Zendesk tools (separate specs)
- HTTP bridge / Pro tier wiring
