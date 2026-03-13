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
}
