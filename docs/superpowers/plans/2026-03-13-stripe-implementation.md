# Stripe Mock Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the mock Stripe integration — a `set_mock_scenario` session tool, 9 Stripe tools (customers, payment intents, subscriptions), and server wiring — with two-layer scenario injection for realistic error simulation.

**Architecture:** Tool handlers are exported as named async functions for direct testability, then registered via `registerXxxTools(server)` calls. A 3-line scenario check sits at the top of every handler; payment intent tools check Layer 1 (inline test token) then Layer 2 (session scenario); all other tools check Layer 2 only. See spec: `docs/superpowers/specs/2026-03-13-stripe-design.md`.

**Tech Stack:** TypeScript strict, Node.js 22, ESM (`"type": "module"`, `"moduleResolution": "NodeNext"` — all imports use `.js` extensions), @modelcontextprotocol/sdk, @faker-js/faker, Zod, Vitest (new test dependency).

---

## Chunk 1: Test Infrastructure + Session Tool

### Task 1: Set up Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest
```

Expected: `vitest` appears in `package.json` devDependencies.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 3: Add test scripts to `package.json`**

In the `"scripts"` block, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:typecheck": "tsc --project tsconfig.test.json --noEmit"
```

- [ ] **Step 4: Create `tsconfig.test.json`**

The root `tsconfig.json` has `"rootDir": "./src"` which excludes `tests/`. Create a separate config for type-checking tests:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 5: Verify setup**

```bash
npm test
```

Expected: Exits 0. "No test files found" or similar — no errors about config.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tsconfig.test.json package.json package-lock.json
git commit -m "chore: add Vitest test infrastructure and tsconfig.test.json"
```

---

### Task 2: `set_mock_scenario` session tool

**Files:**
- Create: `src/tools/session.ts`
- Create: `tests/tools/session.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/tools/session.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../../src/db/store.js";
import { setMockScenarioHandler } from "../../src/tools/session.js";

beforeEach(() => store.reset());

describe("set_mock_scenario", () => {
  it("sets a valid scenario on the session", async () => {
    const result = await setMockScenarioHandler({ scenarioId: "payment_declined" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("payment_declined");
    expect(store.getSession()?.scenarioId).toBe("payment_declined");
  });

  it("clears the scenario when called without scenarioId", async () => {
    await setMockScenarioHandler({ scenarioId: "rate_limit_exceeded" });
    expect(store.getSession()?.scenarioId).toBe("rate_limit_exceeded");

    const result = await setMockScenarioHandler({});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("happy path");
    // Confirm session still exists (startSession was called, not reset)
    expect(store.getSession()).not.toBeNull();
    expect(store.getSession()?.scenarioId).toBeUndefined();
  });

  it("returns isError for an unrecognised scenarioId", async () => {
    const result = await setMockScenarioHandler({ scenarioId: "does_not_exist" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("payment_declined");
    expect(result.content[0].text).toContain("rate_limit_exceeded");
  });

  it("preserves existing store data when scenario changes", async () => {
    store.stripe.customers.set("cus_test", {
      id: "cus_test",
      email: "a@b.com",
      name: "Test",
      created: 0,
      metadata: {},
    });
    await setMockScenarioHandler({ scenarioId: "payment_declined" });
    expect(store.stripe.customers.has("cus_test")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test tests/tools/session.test.ts
```

Expected: FAIL — "Cannot find module '../../src/tools/session.js'"

- [ ] **Step 3: Implement `src/tools/session.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { store } from "../db/store.js";
import { SCENARIOS } from "../scenarios/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Exported for direct testing — registered below via registerSessionTools.
export async function setMockScenarioHandler(input: {
  scenarioId?: string;
}): Promise<CallToolResult> {
  const { scenarioId } = input;

  if (scenarioId !== undefined) {
    const validKeys = Object.keys(SCENARIOS);
    if (!validKeys.includes(scenarioId)) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown scenario: "${scenarioId}". Valid values are: ${validKeys.join(", ")}`,
          },
        ],
        isError: true,
      };
    }
    store.startSession(scenarioId);
    return {
      content: [{ type: "text", text: `Active scenario set to: ${scenarioId}` }],
    };
  }

  store.startSession();
  return {
    content: [
      { type: "text", text: "Active scenario cleared. Running in happy path mode." },
    ],
  };
}

export function registerSessionTools(server: McpServer): void {
  server.tool(
    "set_mock_scenario",
    "Set or clear the active mock scenario. When active, ALL tools return realistic Stripe error payloads. Valid IDs: payment_declined, insufficient_funds, invalid_cvc, expired_card, rate_limit_exceeded. Omit scenarioId to reset to happy path.",
    {
      scenarioId: z
        .string()
        .optional()
        .describe(
          "Scenario to activate. One of: payment_declined, insufficient_funds, invalid_cvc, expired_card, rate_limit_exceeded. Omit to reset to happy path."
        ),
    },
    setMockScenarioHandler
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/tools/session.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/session.ts tests/tools/session.test.ts
git commit -m "feat: add set_mock_scenario session tool"
```

---

## Chunk 2: Stripe Customers + Payment Intents

### Task 3: Stripe customer tools — create, retrieve, list

**Files:**
- Create: `src/tools/stripe.ts`
- Create: `tests/tools/stripe.test.ts`

> Note: `stripe.test.ts` is created here with ALL handler imports declared up front. The payment intent and subscription imports will cause TypeScript errors on first run — this is expected. Each subsequent task adds the missing exports and clears the errors.

- [ ] **Step 1: Create `tests/tools/stripe.test.ts` with all imports and ALL test cases**

All 36 tests are written here up front. Customer tests pass immediately. Payment intent and subscription tests will throw "Not yet implemented" until Tasks 4 and 5 replace the stubs — this is the expected TDD red state.

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../../src/db/store.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
} from "../../src/tools/stripe.js";

beforeEach(() => store.reset());

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function parseOk(fn: () => Promise<CallToolResult>) {
  const result = await fn();
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0].text);
}

async function parseErr(fn: () => Promise<CallToolResult>) {
  const result = await fn();
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0].text);
}

// ─── Customers ────────────────────────────────────────────────────────────────

describe("stripe_create_customer", () => {
  it("creates and stores a customer", async () => {
    const body = await parseOk(() =>
      stripeCreateCustomerHandler({ email: "alice@example.com", name: "Alice" })
    );
    expect(body.id).toMatch(/^cus_/);
    expect(body.email).toBe("alice@example.com");
    expect(body.name).toBe("Alice");
    expect(typeof body.created).toBe("number");
    expect(store.stripe.customers.has(body.id)).toBe(true);
  });

  it("stores provided metadata", async () => {
    const body = await parseOk(() =>
      stripeCreateCustomerHandler({ email: "b@b.com", name: "B", metadata: { plan: "pro" } })
    );
    expect(body.metadata).toEqual({ plan: "pro" });
  });

  it("defaults metadata to empty object", async () => {
    const body = await parseOk(() =>
      stripeCreateCustomerHandler({ email: "c@c.com", name: "C" })
    );
    expect(body.metadata).toEqual({});
  });

  it("returns scenario error when Layer 2 is active", async () => {
    store.startSession("rate_limit_exceeded");
    const err = await parseErr(() =>
      stripeCreateCustomerHandler({ email: "x@x.com", name: "X" })
    );
    expect(err.error.code).toBe("rate_limit");
    expect(store.stripe.customers.size).toBe(0);
  });
});

describe("stripe_retrieve_customer", () => {
  it("retrieves a stored customer", async () => {
    const created = await parseOk(() =>
      stripeCreateCustomerHandler({ email: "d@d.com", name: "D" })
    );
    const retrieved = await parseOk(() =>
      stripeRetrieveCustomerHandler({ id: created.id })
    );
    expect(retrieved.id).toBe(created.id);
    expect(retrieved.email).toBe("d@d.com");
  });

  it("returns resource_missing for unknown id", async () => {
    const err = await parseErr(() =>
      stripeRetrieveCustomerHandler({ id: "cus_doesnotexist" })
    );
    expect(err.error.code).toBe("resource_missing");
    expect(err.error.message).toContain("cus_doesnotexist");
  });

  it("returns scenario error when Layer 2 is active", async () => {
    store.startSession("payment_declined");
    const err = await parseErr(() =>
      stripeRetrieveCustomerHandler({ id: "cus_anything" })
    );
    expect(err.error.code).toBe("card_declined");
  });
});

describe("stripe_list_customers", () => {
  it("returns empty envelope when no customers", async () => {
    const body = await parseOk(() => stripeListCustomersHandler({}));
    expect(body).toEqual({ data: [], hasMore: false });
  });

  it("returns all customers up to limit", async () => {
    await stripeCreateCustomerHandler({ email: "e1@e.com", name: "E1" });
    await stripeCreateCustomerHandler({ email: "e2@e.com", name: "E2" });
    const body = await parseOk(() => stripeListCustomersHandler({ limit: 10 }));
    expect(body.data).toHaveLength(2);
    expect(body.hasMore).toBe(false);
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await stripeCreateCustomerHandler({ email: `f${i}@f.com`, name: `F${i}` });
    }
    const body = await parseOk(() => stripeListCustomersHandler({ limit: 3 }));
    expect(body.data).toHaveLength(3);
  });

  it("returns scenario error when Layer 2 is active", async () => {
    store.startSession("rate_limit_exceeded");
    const result = await stripeListCustomersHandler({});
    expect(result.isError).toBe(true);
  });
});

// ─── Payment Intents ──────────────────────────────────────────────────────────

describe("stripe_create_payment_intent", () => {
  it("creates with requires_payment_method when no payment_method given", async () => {
    const body = await parseOk(() =>
      stripeCreatePaymentIntentHandler({ amount: 1000, currency: "usd" })
    );
    expect(body.id).toMatch(/^pi_/);
    expect(body.amount).toBe(1000);
    expect(body.currency).toBe("usd");
    expect(body.status).toBe("requires_payment_method");
    expect(store.stripe.paymentIntents.has(body.id)).toBe(true);
  });

  it("creates with status succeeded when a real-looking payment_method is provided", async () => {
    const body = await parseOk(() =>
      stripeCreatePaymentIntentHandler({ amount: 500, currency: "eur", payment_method: "pm_card_visa" })
    );
    expect(body.status).toBe("succeeded");
  });

  it("returns card_declined for tok_chargeDeclined (Layer 1)", async () => {
    const err = await parseErr(() =>
      stripeCreatePaymentIntentHandler({ amount: 1000, currency: "usd", payment_method: "tok_chargeDeclined" })
    );
    expect(err.error.code).toBe("card_declined");
    expect(err.error.decline_code).toBe("generic_decline");
    expect(store.stripe.paymentIntents.size).toBe(0);
  });

  it("returns insufficient_funds for tok_chargeDeclinedInsufficientFunds (Layer 1)", async () => {
    const err = await parseErr(() =>
      stripeCreatePaymentIntentHandler({ amount: 999, currency: "usd", payment_method: "tok_chargeDeclinedInsufficientFunds" })
    );
    expect(err.error.decline_code).toBe("insufficient_funds");
  });

  it("Layer 1 fires and wins over Layer 2 when both are active", async () => {
    store.startSession("rate_limit_exceeded");
    const err = await parseErr(() =>
      stripeCreatePaymentIntentHandler({ amount: 100, currency: "usd", payment_method: "tok_chargeDeclined" })
    );
    expect(err.error.code).toBe("card_declined"); // Layer 1 wins — not rate_limit
  });

  it("returns rate_limit when Layer 2 session scenario is active and no token given", async () => {
    store.startSession("rate_limit_exceeded");
    const err = await parseErr(() =>
      stripeCreatePaymentIntentHandler({ amount: 100, currency: "usd" })
    );
    expect(err.error.code).toBe("rate_limit");
  });

  it("power-user: raw scenario key as payment_method triggers Layer 1", async () => {
    const err = await parseErr(() =>
      stripeCreatePaymentIntentHandler({ amount: 100, currency: "usd", payment_method: "payment_declined" })
    );
    expect(err.error.code).toBe("card_declined");
  });
});

describe("stripe_retrieve_payment_intent", () => {
  it("retrieves a stored payment intent", async () => {
    const created = await parseOk(() =>
      stripeCreatePaymentIntentHandler({ amount: 2000, currency: "usd" })
    );
    const retrieved = await parseOk(() =>
      stripeRetrievePaymentIntentHandler({ id: created.id })
    );
    expect(retrieved.id).toBe(created.id);
    expect(retrieved.amount).toBe(2000);
  });

  it("returns resource_missing for unknown id", async () => {
    const err = await parseErr(() =>
      stripeRetrievePaymentIntentHandler({ id: "pi_doesnotexist" })
    );
    expect(err.error.code).toBe("resource_missing");
    expect(err.error.message).toContain("pi_doesnotexist");
  });

  it("returns scenario error when Layer 2 is active", async () => {
    store.startSession("payment_declined");
    const err = await parseErr(() =>
      stripeRetrievePaymentIntentHandler({ id: "pi_anything" })
    );
    expect(err.error.code).toBe("card_declined");
  });
});

describe("stripe_list_payment_intents", () => {
  it("returns empty envelope when no payment intents", async () => {
    const body = await parseOk(() => stripeListPaymentIntentsHandler({}));
    expect(body).toEqual({ data: [], hasMore: false });
  });

  it("filters by customer_id when provided", async () => {
    await stripeCreatePaymentIntentHandler({ amount: 100, currency: "usd", customer_id: "cus_aaa" });
    await stripeCreatePaymentIntentHandler({ amount: 200, currency: "usd", customer_id: "cus_bbb" });
    await stripeCreatePaymentIntentHandler({ amount: 300, currency: "usd" });
    const body = await parseOk(() => stripeListPaymentIntentsHandler({ customer_id: "cus_aaa" }));
    expect(body.data).toHaveLength(1);
    expect(body.data[0].customerId).toBe("cus_aaa");
  });

  it("returns scenario error when Layer 2 is active", async () => {
    store.startSession("rate_limit_exceeded");
    const result = await stripeListPaymentIntentsHandler({});
    expect(result.isError).toBe(true);
  });
});

// ─── Subscriptions ────────────────────────────────────────────────────────────
// These pass once Task 5 replaces the stubs.

describe("stripe_create_subscription", () => {
  it("creates and stores a subscription", async () => {
    const customer = await parseOk(() =>
      stripeCreateCustomerHandler({ email: "g@g.com", name: "G" })
    );
    const body = await parseOk(() =>
      stripeCreateSubscriptionHandler({ customer_id: customer.id, price_id: "price_monthly" })
    );
    expect(body.id).toMatch(/^sub_/);
    expect(body.customerId).toBe(customer.id);
    expect(body.priceId).toBe("price_monthly");
    expect(body.status).toBe("active");
    expect(typeof body.currentPeriodEnd).toBe("number");
    expect(body.currentPeriodEnd).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(store.stripe.subscriptions.has(body.id)).toBe(true);
  });

  it("returns resource_missing when customer_id does not exist", async () => {
    const err = await parseErr(() =>
      stripeCreateSubscriptionHandler({ customer_id: "cus_nonexistent", price_id: "price_abc" })
    );
    expect(err.error.code).toBe("resource_missing");
    expect(err.error.message).toContain("cus_nonexistent");
  });

  it("accepts price_id as opaque string without validation", async () => {
    const customer = await parseOk(() =>
      stripeCreateCustomerHandler({ email: "h@h.com", name: "H" })
    );
    const body = await parseOk(() =>
      stripeCreateSubscriptionHandler({ customer_id: customer.id, price_id: "any_arbitrary_price_string" })
    );
    expect(body.priceId).toBe("any_arbitrary_price_string");
  });

  it("stores provided metadata", async () => {
    const customer = await parseOk(() =>
      stripeCreateCustomerHandler({ email: "i@i.com", name: "I" })
    );
    const body = await parseOk(() =>
      stripeCreateSubscriptionHandler({ customer_id: customer.id, price_id: "price_x", metadata: { tier: "pro" } })
    );
    expect(body.metadata).toEqual({ tier: "pro" });
  });

  it("defaults metadata to empty object", async () => {
    const customer = await parseOk(() =>
      stripeCreateCustomerHandler({ email: "j@j.com", name: "J" })
    );
    const body = await parseOk(() =>
      stripeCreateSubscriptionHandler({ customer_id: customer.id, price_id: "price_y" })
    );
    expect(body.metadata).toEqual({});
  });

  it("returns scenario error when Layer 2 is active", async () => {
    store.startSession("rate_limit_exceeded");
    const err = await parseErr(() =>
      stripeCreateSubscriptionHandler({ customer_id: "cus_any", price_id: "price_any" })
    );
    expect(err.error.code).toBe("rate_limit");
    expect(store.stripe.subscriptions.size).toBe(0);
  });
});

describe("stripe_retrieve_subscription", () => {
  it("retrieves a stored subscription", async () => {
    const customer = await parseOk(() =>
      stripeCreateCustomerHandler({ email: "k@k.com", name: "K" })
    );
    const created = await parseOk(() =>
      stripeCreateSubscriptionHandler({ customer_id: customer.id, price_id: "price_z" })
    );
    const retrieved = await parseOk(() =>
      stripeRetrieveSubscriptionHandler({ id: created.id })
    );
    expect(retrieved.id).toBe(created.id);
  });

  it("returns resource_missing for unknown id", async () => {
    const err = await parseErr(() =>
      stripeRetrieveSubscriptionHandler({ id: "sub_doesnotexist" })
    );
    expect(err.error.code).toBe("resource_missing");
    expect(err.error.message).toContain("sub_doesnotexist");
  });

  it("returns scenario error when Layer 2 is active", async () => {
    store.startSession("expired_card");
    const err = await parseErr(() =>
      stripeRetrieveSubscriptionHandler({ id: "sub_any" })
    );
    expect(err.error.code).toBe("expired_card");
  });
});

describe("stripe_list_subscriptions", () => {
  it("returns empty envelope when no subscriptions", async () => {
    const body = await parseOk(() => stripeListSubscriptionsHandler({}));
    expect(body).toEqual({ data: [], hasMore: false });
  });

  it("filters by customer_id when provided", async () => {
    const c1 = await parseOk(() =>
      stripeCreateCustomerHandler({ email: "l1@l.com", name: "L1" })
    );
    const c2 = await parseOk(() =>
      stripeCreateCustomerHandler({ email: "l2@l.com", name: "L2" })
    );
    await stripeCreateSubscriptionHandler({ customer_id: c1.id, price_id: "price_a" });
    await stripeCreateSubscriptionHandler({ customer_id: c2.id, price_id: "price_b" });
    const body = await parseOk(() => stripeListSubscriptionsHandler({ customer_id: c1.id }));
    expect(body.data).toHaveLength(1);
    expect(body.data[0].customerId).toBe(c1.id);
  });

  it("returns scenario error when Layer 2 is active", async () => {
    store.startSession("invalid_cvc");
    const result = await stripeListSubscriptionsHandler({});
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test tests/tools/stripe.test.ts
```

Expected: FAIL — "Cannot find module '../../src/tools/stripe.js'"

- [ ] **Step 3: Create `src/tools/stripe.ts` with shared helpers and customer handlers**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { store, newId } from "../db/store.js";
import type { StripeCustomer, StripePaymentIntent, StripeSubscription } from "../db/store.js";
import { resolveScenario } from "../scenarios/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Alias for readability inside this file
type ToolResult = CallToolResult;

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function scenarioErr(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
}

function resourceMissing(id: string): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: {
            type: "invalid_request_error",
            code: "resource_missing",
            message: `No such resource: '${id}'`,
          },
        }),
      },
    ],
    isError: true,
  };
}

// Used by stripeCreateSubscriptionHandler (Task 5) to distinguish
// "no such customer" from the generic "no such resource" message.
function customerMissing(id: string): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: {
            type: "invalid_request_error",
            code: "resource_missing",
            message: `No such customer: '${id}'`,
          },
        }),
      },
    ],
    isError: true,
  };
}

// ─── Customers ────────────────────────────────────────────────────────────────

export async function stripeCreateCustomerHandler(input: {
  email: string;
  name: string;
  metadata?: Record<string, string>;
}): Promise<ToolResult> {
  const err = resolveScenario(undefined, store.getSession()?.scenarioId);
  if (err) return scenarioErr(err);

  const customer: StripeCustomer = {
    id: newId.stripeCustomer(),
    email: input.email,
    name: input.name,
    created: Math.floor(Date.now() / 1000),
    metadata: input.metadata ?? {},
  };
  store.stripe.customers.set(customer.id, customer);
  return ok(customer);
}

export async function stripeRetrieveCustomerHandler(input: {
  id: string;
}): Promise<ToolResult> {
  const err = resolveScenario(undefined, store.getSession()?.scenarioId);
  if (err) return scenarioErr(err);

  const customer = store.stripe.customers.get(input.id);
  if (!customer) return resourceMissing(input.id);
  return ok(customer);
}

export async function stripeListCustomersHandler(input: {
  limit?: number;
}): Promise<ToolResult> {
  const err = resolveScenario(undefined, store.getSession()?.scenarioId);
  if (err) return scenarioErr(err);

  const data = Array.from(store.stripe.customers.values()).slice(0, input.limit ?? 10);
  return ok({ data, hasMore: false });
}

// ─── Payment Intent stubs (added in Task 4) ──────────────────────────────────

export async function stripeCreatePaymentIntentHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
export async function stripeRetrievePaymentIntentHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
export async function stripeListPaymentIntentsHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}

// ─── Subscription stubs (added in Task 5) ────────────────────────────────────

export async function stripeCreateSubscriptionHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
export async function stripeRetrieveSubscriptionHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
export async function stripeListSubscriptionsHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerStripeTools(server: McpServer): void {
  server.tool(
    "stripe_create_customer",
    "Create a mock Stripe customer. Returns a StripeCustomer with a realistic cus_ prefixed ID.",
    {
      email: z.string().email().describe("Customer email address"),
      name: z.string().describe("Customer full name"),
      metadata: z.record(z.string()).optional().describe("Arbitrary key-value metadata"),
    },
    stripeCreateCustomerHandler
  );

  server.tool(
    "stripe_retrieve_customer",
    "Retrieve a mock Stripe customer by ID. Returns resource_missing if not found.",
    {
      id: z.string().describe("Customer ID (cus_...)"),
    },
    stripeRetrieveCustomerHandler
  );

  server.tool(
    "stripe_list_customers",
    "List mock Stripe customers. Returns up to limit results (default 10, max 100).",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .optional()
        .describe("Max results (1–100, default 10)"),
    },
    stripeListCustomersHandler
  );
}
```

- [ ] **Step 4: Run customer tests — confirm they pass, stubs make payment intent / subscription tests throw but not fail imports**

```bash
npm test tests/tools/stripe.test.ts
```

Expected: Customer describe blocks PASS. Payment intent and subscription tests FAIL with "Not yet implemented" — this is correct.

- [ ] **Step 5: Commit**

```bash
git add src/tools/stripe.ts tests/tools/stripe.test.ts
git commit -m "feat: add stripe customer tools (create, retrieve, list)"
```

---

### Task 4: Stripe payment intent tools with Layer 1 + Layer 2 scenario injection

**Files:**
- Modify: `src/tools/stripe.ts` — replace payment intent stubs, add registrations

- [ ] **Step 1: Confirm payment intent tests are failing with "Not yet implemented"**

```bash
npm test tests/tools/stripe.test.ts
```

Expected: Customer describe blocks PASS. Payment intent and subscription tests FAIL with "Not yet implemented".

- [ ] **Step 2: Replace the three payment intent stubs in `src/tools/stripe.ts`**

Replace the stub block:

```ts
// ─── Payment Intent stubs (added in Task 4) ──────────────────────────────────

export async function stripeCreatePaymentIntentHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
export async function stripeRetrievePaymentIntentHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
export async function stripeListPaymentIntentsHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
```

With the real implementations:

```ts
// ─── Payment Intents ──────────────────────────────────────────────────────────

export async function stripeCreatePaymentIntentHandler(input: {
  amount: number;
  currency: string;
  payment_method?: string;
  customer_id?: string;
  metadata?: Record<string, string>;
}): Promise<ToolResult> {
  // Layer 1 (inline token) is checked first, then Layer 2 (session scenario).
  // If a scenario fires, NO entity is created or stored.
  const err = resolveScenario(input.payment_method, store.getSession()?.scenarioId);
  if (err) return scenarioErr(err);

  const intent: StripePaymentIntent = {
    id: newId.stripePaymentIntent(),
    amount: input.amount,
    currency: input.currency,
    status: input.payment_method ? "succeeded" : "requires_payment_method",
    customerId: input.customer_id,
    created: Math.floor(Date.now() / 1000),
    metadata: input.metadata ?? {},
  };
  store.stripe.paymentIntents.set(intent.id, intent);
  return ok(intent);
}

export async function stripeRetrievePaymentIntentHandler(input: {
  id: string;
}): Promise<ToolResult> {
  const err = resolveScenario(undefined, store.getSession()?.scenarioId);
  if (err) return scenarioErr(err);

  const intent = store.stripe.paymentIntents.get(input.id);
  if (!intent) return resourceMissing(input.id);
  return ok(intent);
}

export async function stripeListPaymentIntentsHandler(input: {
  customer_id?: string;
  limit?: number;
}): Promise<ToolResult> {
  const err = resolveScenario(undefined, store.getSession()?.scenarioId);
  if (err) return scenarioErr(err);

  let data = Array.from(store.stripe.paymentIntents.values());
  if (input.customer_id) {
    data = data.filter((pi) => pi.customerId === input.customer_id);
  }
  return ok({ data: data.slice(0, input.limit ?? 10), hasMore: false });
}
```

- [ ] **Step 3: Add payment intent tool registrations inside `registerStripeTools`**

Append inside the `registerStripeTools` function body (after the existing three customer tool registrations):

```ts
  server.tool(
    "stripe_create_payment_intent",
    "Create a mock Stripe PaymentIntent. Pass a test token as payment_method to trigger card errors (e.g. tok_chargeDeclined, tok_chargeDeclinedInsufficientFunds, tok_chargeDeclinedIncorrectCvc, tok_chargeDeclinedExpiredCard). Any raw scenario key also works (power-user feature). Status is 'succeeded' if payment_method is provided, 'requires_payment_method' otherwise.",
    {
      amount: z.number().int().positive().describe("Amount in cents (e.g. 1000 = $10.00)"),
      currency: z.string().length(3).describe("ISO 4217 currency code (e.g. 'usd', 'eur')"),
      payment_method: z
        .string()
        .optional()
        .describe("Test token (e.g. tok_chargeDeclined) or real payment method ID"),
      customer_id: z.string().optional().describe("ID of the customer to associate"),
      metadata: z.record(z.string()).optional().describe("Arbitrary key-value metadata"),
    },
    stripeCreatePaymentIntentHandler
  );

  server.tool(
    "stripe_retrieve_payment_intent",
    "Retrieve a mock Stripe PaymentIntent by ID. Returns resource_missing if not found.",
    {
      id: z.string().describe("Payment intent ID (pi_...)"),
    },
    stripeRetrievePaymentIntentHandler
  );

  server.tool(
    "stripe_list_payment_intents",
    "List mock Stripe PaymentIntents. Optionally filter by customer_id.",
    {
      customer_id: z.string().optional().describe("Filter by customer ID"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .optional()
        .describe("Max results (1–100, default 10)"),
    },
    stripeListPaymentIntentsHandler
  );
```

- [ ] **Step 4: Run tests — all customer + payment intent tests should pass**

```bash
npm test tests/tools/stripe.test.ts
```

Expected: Customer tests PASS. Payment intent tests PASS. Subscription tests still FAIL with "Not yet implemented".

- [ ] **Step 5: Commit**

```bash
git add src/tools/stripe.ts
git commit -m "feat: add stripe payment intent tools with Layer 1+2 scenario injection"
```

---

## Chunk 3: Stripe Subscriptions + Server Wiring

### Task 5: Stripe subscription tools

**Files:**
- Modify: `src/tools/stripe.ts` — replace subscription stubs, add registrations

- [ ] **Step 1: Confirm subscription tests are failing with "Not yet implemented"**

```bash
npm test tests/tools/stripe.test.ts
```

Expected: Customer + payment intent tests PASS. Subscription tests FAIL with "Not yet implemented".

- [ ] **Step 2: Replace the three subscription stubs in `src/tools/stripe.ts`**

Replace the stub block:

```ts
// ─── Subscription stubs (added in Task 5) ────────────────────────────────────

export async function stripeCreateSubscriptionHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
export async function stripeRetrieveSubscriptionHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
export async function stripeListSubscriptionsHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
```

With the real implementations:

```ts
// ─── Subscriptions ────────────────────────────────────────────────────────────

export async function stripeCreateSubscriptionHandler(input: {
  customer_id: string;
  price_id: string;
  metadata?: Record<string, string>;
}): Promise<ToolResult> {
  const err = resolveScenario(undefined, store.getSession()?.scenarioId);
  if (err) return scenarioErr(err);

  if (!store.stripe.customers.has(input.customer_id)) {
    return customerMissing(input.customer_id);
  }

  const now = Math.floor(Date.now() / 1000);
  const subscription: StripeSubscription = {
    id: newId.stripeSubscription(),
    customerId: input.customer_id,
    status: "active",
    priceId: input.price_id,
    currentPeriodEnd: now + 30 * 24 * 60 * 60,
    created: now,
    metadata: input.metadata ?? {},
  };
  store.stripe.subscriptions.set(subscription.id, subscription);
  return ok(subscription);
}

export async function stripeRetrieveSubscriptionHandler(input: {
  id: string;
}): Promise<ToolResult> {
  const err = resolveScenario(undefined, store.getSession()?.scenarioId);
  if (err) return scenarioErr(err);

  const subscription = store.stripe.subscriptions.get(input.id);
  if (!subscription) return resourceMissing(input.id);
  return ok(subscription);
}

export async function stripeListSubscriptionsHandler(input: {
  customer_id?: string;
  limit?: number;
}): Promise<ToolResult> {
  const err = resolveScenario(undefined, store.getSession()?.scenarioId);
  if (err) return scenarioErr(err);

  let data = Array.from(store.stripe.subscriptions.values());
  if (input.customer_id) {
    data = data.filter((sub) => sub.customerId === input.customer_id);
  }
  return ok({ data: data.slice(0, input.limit ?? 10), hasMore: false });
}
```

- [ ] **Step 3: Add subscription tool registrations inside `registerStripeTools`**

Append after the payment intent registrations:

```ts
  server.tool(
    "stripe_create_subscription",
    "Create a mock Stripe subscription for an existing customer. Returns resource_missing if the customer does not exist. price_id is accepted as any string — no catalog validation.",
    {
      customer_id: z.string().describe("ID of the customer (must exist in the mock store)"),
      price_id: z.string().describe("Price ID (any string — no catalog validation)"),
      metadata: z.record(z.string()).optional().describe("Arbitrary key-value metadata"),
    },
    stripeCreateSubscriptionHandler
  );

  server.tool(
    "stripe_retrieve_subscription",
    "Retrieve a mock Stripe subscription by ID. Returns resource_missing if not found.",
    {
      id: z.string().describe("Subscription ID (sub_...)"),
    },
    stripeRetrieveSubscriptionHandler
  );

  server.tool(
    "stripe_list_subscriptions",
    "List mock Stripe subscriptions. Optionally filter by customer_id.",
    {
      customer_id: z.string().optional().describe("Filter by customer ID"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .optional()
        .describe("Max results (1–100, default 10)"),
    },
    stripeListSubscriptionsHandler
  );
```

- [ ] **Step 4: Run the full test suite — all tests should pass**

```bash
npm test
```

Expected: ALL 40 tests pass — session (4) + customers (11) + payment intents (13) + subscriptions (12).

- [ ] **Step 5: Commit**

```bash
git add src/tools/stripe.ts
git commit -m "feat: add stripe subscription tools (create, retrieve, list)"
```

---

### Task 6: Wire tools into `src/server.ts`

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add imports to `src/server.ts`**

After the existing imports at the top of `src/server.ts`, add:

```ts
import { registerSessionTools } from "./tools/session.js";
import { registerStripeTools } from "./tools/stripe.js";
```

- [ ] **Step 2: Call registrations in `src/server.ts`**

After the existing `server.tool(...)` calls for ping and get_server_info (and before `async function main()`), add:

```ts
// --- Integration tool registration ---
registerSessionTools(server);
registerStripeTools(server);
```

- [ ] **Step 3: Verify the server compiles**

```bash
npm run build
```

Expected: Exits 0. `dist/` directory populated with no TypeScript errors.

- [ ] **Step 4: Run full test suite one final time**

```bash
npm test
```

Expected: ALL tests pass.

- [ ] **Step 5: Update `CLAUDE.md` build status**

In `CLAUDE.md`, make these three edits:

1. Mark `src/scenarios/index.ts` as done (it was implemented before this plan):
   Change `- [ ] src/scenarios/index.ts` → `- [x] src/scenarios/index.ts`

2. Mark `src/tools/stripe.ts` as done:
   Change `- [ ] src/tools/stripe.ts  ← NEXT` → `- [x] src/tools/stripe.ts`

3. Add `src/tools/session.ts` as a new checked item (it has no existing line — add it after the stripe.ts line):
   `- [x] src/tools/session.ts  ← set_mock_scenario tool`

- [ ] **Step 6: Final commit**

```bash
git add src/server.ts CLAUDE.md
git commit -m "feat: wire session and stripe tools into MCP server — Stripe integration complete"
```
