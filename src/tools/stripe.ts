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

// ─── Payment Intent stubs (replaced in Task 4) ───────────────────────────────

export async function stripeCreatePaymentIntentHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
export async function stripeRetrievePaymentIntentHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}
export async function stripeListPaymentIntentsHandler(_input: unknown): Promise<ToolResult> {
  throw new Error("Not yet implemented");
}

// ─── Subscription stubs (replaced in Task 5) ─────────────────────────────────

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
