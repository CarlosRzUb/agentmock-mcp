# Express HTTP Bridge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a Stripe-compatible Express HTTP server that wraps the existing mock handlers, enabling developers to use the real Stripe SDK against the mock with a single env-var change.

**Architecture:** Thin adapter layer in `src/bridge/express.ts` — routes parse HTTP requests, call existing handlers from `src/tools/stripe.ts` / `src/tools/session.ts`, and translate MCP-shaped results (`{ content, isError }`) into proper HTTP responses with correct status codes. No business logic lives in the bridge. The MCP stdio server is untouched.

**Tech Stack:** TypeScript strict, ESM (`"type": "module"`, all imports use `.js` extensions), Node.js 22, Express 5 (`^5.2.1`), cors, supertest (testing).

**Spec:** `docs/superpowers/specs/2026-03-13-express-bridge-design.md`

---

## Chunk 1: Dependencies + App Skeleton + All Tests

### Task 1: Install dependencies and add bridge script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install cors and supertest**

```bash
npm install cors
npm install -D @types/cors supertest @types/supertest
```

Expected: `cors` in `dependencies`, `@types/cors`, `supertest`, `@types/supertest` in `devDependencies`.

- [ ] **Step 2: Add bridge script to package.json**

In the `"scripts"` block, add:

```json
"bridge": "tsx src/bridge/express.ts"
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install cors and supertest, add bridge npm script"
```

---

### Task 2: Create Express app skeleton + write ALL tests

**Files:**
- Create: `src/bridge/express.ts`
- Create: `tests/bridge/express.test.ts`

- [ ] **Step 1: Create `tests/bridge/express.test.ts` with all 24 tests**

All tests are written up front. Auth tests pass immediately (middleware exists). Route tests fail with 404 (routes not yet added) — this is the correct TDD red state.

```ts
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { store } from "../../src/db/store.js";
import { app } from "../../src/bridge/express.js";

const KEY = "sk_test_agentmock";

beforeAll(() => {
  process.env.AGENTMOCK_API_KEY = KEY;
});

beforeEach(() => store.reset());

const auth = () => ({ Authorization: `Bearer ${KEY}` });

// ─── Auth middleware ──────────────────────────────────────────────────────────

describe("auth middleware", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app).get("/v1/customers");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("api_key_invalid");
  });

  it("returns 401 when API key is wrong", async () => {
    const res = await request(app)
      .get("/v1/customers")
      .set({ Authorization: "Bearer wrong_key" });
    expect(res.status).toBe(401);
  });

  it("passes through with correct API key (route returns 200 or 404, not 401)", async () => {
    const res = await request(app).get("/v1/customers").set(auth());
    expect(res.status).not.toBe(401);
  });
});

// ─── Customers ────────────────────────────────────────────────────────────────

describe("POST /v1/customers", () => {
  it("creates a customer and returns 200", async () => {
    const res = await request(app)
      .post("/v1/customers")
      .set(auth())
      .send({ email: "alice@example.com", name: "Alice" });
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^cus_/);
    expect(res.body.email).toBe("alice@example.com");
  });

  it("returns 429 when rate_limit_exceeded scenario is active", async () => {
    store.startSession("rate_limit_exceeded");
    const res = await request(app)
      .post("/v1/customers")
      .set(auth())
      .send({ email: "x@x.com", name: "X" });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("rate_limit");
  });
});

describe("GET /v1/customers/:id", () => {
  it("retrieves a customer by id", async () => {
    const createRes = await request(app)
      .post("/v1/customers")
      .set(auth())
      .send({ email: "b@b.com", name: "B" });
    const id = createRes.body.id;

    const res = await request(app).get(`/v1/customers/${id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app).get("/v1/customers/cus_unknown").set(auth());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("resource_missing");
  });
});

describe("GET /v1/customers", () => {
  it("returns empty list when no customers", async () => {
    const res = await request(app).get("/v1/customers").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  });

  it("respects ?limit query parameter", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/v1/customers")
        .set(auth())
        .send({ email: `c${i}@c.com`, name: `C${i}` });
    }
    const res = await request(app).get("/v1/customers?limit=2").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it("ignores non-numeric ?limit and returns default list", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/v1/customers")
        .set(auth())
        .send({ email: `d${i}@d.com`, name: `D${i}` });
    }
    // ?limit=abc → parseInt → NaN → Number.isFinite(NaN) is false → limit not passed → default 10
    const res = await request(app).get("/v1/customers?limit=abc").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3); // all 3 returned, not 0
  });
});

// ─── Payment Intents ──────────────────────────────────────────────────────────

describe("POST /v1/payment_intents", () => {
  it("creates with requires_payment_method when no payment_method given", async () => {
    const res = await request(app)
      .post("/v1/payment_intents")
      .set(auth())
      .send({ amount: 1000, currency: "usd" });
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^pi_/);
    expect(res.body.status).toBe("requires_payment_method");
  });

  it("normalises Stripe SDK 'customer' field to 'customer_id'", async () => {
    const res = await request(app)
      .post("/v1/payment_intents")
      .set(auth())
      .send({ amount: 500, currency: "usd", customer: "cus_abc" });
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe("cus_abc");
  });

  it("returns 402 for tok_chargeDeclined (Layer 1 injection)", async () => {
    const res = await request(app)
      .post("/v1/payment_intents")
      .set(auth())
      .send({ amount: 1000, currency: "usd", payment_method: "tok_chargeDeclined" });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("card_declined");
  });
});

describe("GET /v1/payment_intents/:id", () => {
  it("retrieves a payment intent", async () => {
    const createRes = await request(app)
      .post("/v1/payment_intents")
      .set(auth())
      .send({ amount: 2000, currency: "usd" });
    const id = createRes.body.id;

    const res = await request(app).get(`/v1/payment_intents/${id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app).get("/v1/payment_intents/pi_unknown").set(auth());
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/payment_intents", () => {
  it("filters by ?customer query parameter", async () => {
    await request(app)
      .post("/v1/payment_intents")
      .set(auth())
      .send({ amount: 100, currency: "usd", customer: "cus_aaa" });
    await request(app)
      .post("/v1/payment_intents")
      .set(auth())
      .send({ amount: 200, currency: "usd", customer: "cus_bbb" });

    const res = await request(app)
      .get("/v1/payment_intents?customer=cus_aaa")
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].customerId).toBe("cus_aaa");
  });
});

// ─── Subscriptions ────────────────────────────────────────────────────────────

describe("POST /v1/subscriptions", () => {
  it("creates a subscription for an existing customer", async () => {
    const cusRes = await request(app)
      .post("/v1/customers")
      .set(auth())
      .send({ email: "d@d.com", name: "D" });
    const customerId = cusRes.body.id;

    const res = await request(app)
      .post("/v1/subscriptions")
      .set(auth())
      .send({ customer: customerId, price_id: "price_monthly" });
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^sub_/);
    expect(res.body.customerId).toBe(customerId);
    expect(res.body.priceId).toBe("price_monthly");
  });

  it("normalises Stripe SDK 'customer' field to 'customer_id'", async () => {
    const cusRes = await request(app)
      .post("/v1/customers")
      .set(auth())
      .send({ email: "e@e.com", name: "E" });
    const res = await request(app)
      .post("/v1/subscriptions")
      .set(auth())
      .send({ customer: cusRes.body.id, price_id: "price_x" });
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe(cusRes.body.id);
  });

  it("returns 404 for unknown customer", async () => {
    const res = await request(app)
      .post("/v1/subscriptions")
      .set(auth())
      .send({ customer: "cus_nonexistent", price_id: "price_x" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("resource_missing");
  });
});

describe("GET /v1/subscriptions/:id", () => {
  it("retrieves a subscription", async () => {
    const cusRes = await request(app)
      .post("/v1/customers")
      .set(auth())
      .send({ email: "f@f.com", name: "F" });
    const subRes = await request(app)
      .post("/v1/subscriptions")
      .set(auth())
      .send({ customer: cusRes.body.id, price_id: "price_y" });
    const id = subRes.body.id;

    const res = await request(app).get(`/v1/subscriptions/${id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app).get("/v1/subscriptions/sub_unknown").set(auth());
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/subscriptions", () => {
  it("returns empty list when no subscriptions", async () => {
    const res = await request(app).get("/v1/subscriptions").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  });
});

// ─── AgentMock scenario endpoint ──────────────────────────────────────────────

describe("POST /agentmock/scenario", () => {
  it("sets a valid scenario and returns 200 with message", async () => {
    const res = await request(app)
      .post("/agentmock/scenario")
      .set(auth())
      .send({ scenarioId: "payment_declined" });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("payment_declined");
  });

  it("clears the scenario when called without scenarioId", async () => {
    const res = await request(app)
      .post("/agentmock/scenario")
      .set(auth())
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("happy path");
  });

  it("returns 400 for invalid scenarioId", async () => {
    const res = await request(app)
      .post("/agentmock/scenario")
      .set(auth())
      .send({ scenarioId: "not_a_real_scenario" });
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe("invalid_request_error");
  });
});
```

- [ ] **Step 2: Run to verify tests fail (module not found)**

```bash
npm test tests/bridge/express.test.ts
```

Expected: FAIL — "Cannot find module '../../src/bridge/express.js'"

- [ ] **Step 3: Create `src/bridge/express.ts` with middleware only (no routes yet)**

```ts
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
```

- [ ] **Step 4: Run tests to verify auth tests pass, route tests fail with 404**

```bash
npm test tests/bridge/express.test.ts
```

Expected:
- `auth middleware` — 3 tests PASS
- All route tests — FAIL with `expected 200, received 404` (routes not yet added)

- [ ] **Step 5: Commit skeleton**

```bash
git add src/bridge/express.ts tests/bridge/express.test.ts
git commit -m "feat: add Express bridge skeleton with auth middleware and tests"
```

---

## Chunk 2: Route Implementations + Final Verification

### Task 3: Customer routes

**Files:**
- Modify: `src/bridge/express.ts`

- [ ] **Step 1: Add customer routes to `src/bridge/express.ts`**

Add these imports at the top of `src/bridge/express.ts` (after the existing imports):

```ts
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
```

Add the customer routes **before** the global error handler:

```ts
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
```

- [ ] **Step 2: Run tests — customer tests should pass**

```bash
npm test tests/bridge/express.test.ts
```

Expected: auth (3) + customer (6) = 9 tests PASS. Payment intent, subscription, scenario tests still FAIL with 404.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/express.ts
git commit -m "feat: add Express bridge customer routes"
```

---

### Task 4: Payment intent routes

**Files:**
- Modify: `src/bridge/express.ts`

- [ ] **Step 1: Add payment intent routes before the global error handler**

```ts
// ─── Payment Intents ──────────────────────────────────────────────────────────

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
```

- [ ] **Step 2: Run tests — customer + PI tests should pass**

```bash
npm test tests/bridge/express.test.ts
```

Expected: auth (3) + customers (6) + payment intents (5) = 14 tests PASS. Subscription and scenario tests still FAIL.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/express.ts
git commit -m "feat: add Express bridge payment intent routes"
```

---

### Task 5: Subscription routes + scenario endpoint

**Files:**
- Modify: `src/bridge/express.ts`

- [ ] **Step 1: Add subscription routes before the global error handler**

```ts
// ─── Subscriptions ────────────────────────────────────────────────────────────

app.post("/v1/subscriptions", async (req, res) => {
  // Normalise Stripe SDK field name: customer → customer_id
  const body = { ...req.body };
  if (body.customer) { body.customer_id = body.customer; delete body.customer; }

  const result = await stripeCreateSubscriptionHandler(body);
  const data = JSON.parse(result.content[0].text);
  if (result.isError) {
    res.status(httpStatusFor(data)).json(data);
  } else {
    res.status(200).json(data);
  }
});

app.get("/v1/subscriptions/:id", async (req, res) => {
  const result = await stripeRetrieveSubscriptionHandler({ id: req.params.id });
  const data = JSON.parse(result.content[0].text);
  if (result.isError) {
    res.status(httpStatusFor(data)).json(data);
  } else {
    res.status(200).json(data);
  }
});

app.get("/v1/subscriptions", async (req, res) => {
  const rawLimit = req.query.limit;
  const limit = rawLimit ? parseInt(rawLimit as string, 10) : undefined;
  const customer_id = req.query.customer as string | undefined;
  const result = await stripeListSubscriptionsHandler({
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

// ─── AgentMock control endpoint ───────────────────────────────────────────────

// Note: setMockScenarioHandler returns plain text strings (not JSON).
// This route uses a specialised adapter — do NOT JSON.parse the result text.
app.post("/agentmock/scenario", async (req, res) => {
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

- [ ] **Step 2: Run ALL bridge tests — all 24 should pass**

```bash
npm test tests/bridge/express.test.ts
```

Expected: ALL 24 bridge tests PASS.

- [ ] **Step 3: Run full test suite — all 64 tests should pass**

```bash
npm test
```

Expected: ALL tests pass — session (4) + stripe (36) + bridge (24) = 64 total.

- [ ] **Step 4: Commit**

```bash
git add src/bridge/express.ts
git commit -m "feat: add Express bridge subscription routes and scenario endpoint"
```

---

### Task 6: Build verification + CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Verify TypeScript build compiles clean**

```bash
npm run build
```

Expected: Exits 0. `dist/` populated. No TypeScript errors.

- [ ] **Step 2: Run full test suite one final time**

```bash
npm test
```

Expected: ALL 64 tests pass.

- [ ] **Step 3: Update CLAUDE.md build status**

Mark `src/bridge/express.ts` as done:
Change `- [ ] src/bridge/express.ts  ← NEXT (Pro tier — active)` → `- [x] src/bridge/express.ts`

- [ ] **Step 4: Final commit**

```bash
git add CLAUDE.md
git commit -m "feat: Express HTTP bridge complete — Stripe-compatible REST API for Pro tier"
```
