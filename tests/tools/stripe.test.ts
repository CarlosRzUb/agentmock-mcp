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
