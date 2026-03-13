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
