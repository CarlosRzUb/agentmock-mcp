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

### Layer 2 — Session scenario (all tools)

If a session scenario is active, every tool checks it before executing. A single `rate_limit_exceeded` scenario blocks the entire mock API, just like the real Stripe.

**Scenario check pattern** (3 lines, top of every handler):

```ts
const session = store.getSession();
const err = resolveScenario(input.payment_method, session?.scenarioId);
if (err) return { content: [{ type: "text", text: JSON.stringify(err) }], isError: true };
```

Non-payment-intent tools omit the first argument to `resolveScenario`.

---

## Tools

### `src/tools/session.ts`

#### `set_mock_scenario`

Sets or clears the active session scenario.

**Parameters:**
- `scenarioId` (optional string enum) — one of: `payment_declined`, `insufficient_funds`, `invalid_cvc`, `expired_card`, `rate_limit_exceeded`. Omit or pass `null` to reset to happy path.

**Behavior:**
- Calls `store.startSession(scenarioId)` to set or refresh the session
- On unrecognised `scenarioId`: returns a clear error listing valid values (`isError: true`)
- On success: returns a confirmation message with the active scenario ID (or "happy path" if cleared)

---

### `src/tools/stripe.ts`

#### Customers (Layer 2 only)

| Tool | Required params | Optional params |
|---|---|---|
| `stripe_create_customer` | `email`, `name` | `metadata` |
| `stripe_retrieve_customer` | `id` | — |
| `stripe_list_customers` | — | `limit` (default 10, max 100) |

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
- All fields supplied by caller; faker not needed (both `email` and `name` are required)

**`stripe_create_payment_intent`**
- `id`: `newId.stripePaymentIntent()`
- `status`: `"succeeded"` if `payment_method` provided and no scenario fired; `"requires_payment_method"` otherwise
- `created`: Unix timestamp

**`stripe_create_subscription`**
- `id`: `newId.stripeSubscription()`
- `status`: `"active"`
- `currentPeriodEnd`: Unix timestamp 30 days from now
- `created`: Unix timestamp

---

## Edge Cases

| Situation | Response |
|---|---|
| `stripe_retrieve_*` with unknown ID | `{ error: { type: "invalid_request_error", code: "resource_missing", ... } }`, `isError: true` |
| `stripe_list_*` with no data | `{ data: [], has_more: false }` — empty list, not an error |
| `set_mock_scenario` with unknown `scenarioId` | Error listing valid scenario IDs, `isError: true` |

---

## Out of Scope (YAGNI)

- Payment method confirmation flow (`stripe_confirm_payment_intent`)
- Update / delete / cancel operations
- Pagination cursors (only `limit`)
- Webhook simulation
- Shopify / Zendesk tools (separate specs)
- HTTP bridge / Pro tier wiring
