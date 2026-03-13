import { faker } from "@faker-js/faker";

// ─── Session ──────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  createdAt: string;
  scenarioId?: string;
}

// ─── Stripe Types ─────────────────────────────────────────────────────────────

export interface StripeCustomer {
  id: string;
  email: string;
  name: string;
  created: number;
  metadata: Record<string, string>;
}

export interface StripePaymentIntent {
  id: string;
  amount: number; // in cents
  currency: string;
  status:
    | "requires_payment_method"
    | "requires_confirmation"
    | "requires_action"
    | "processing"
    | "succeeded"
    | "canceled";
  customerId?: string;
  created: number;
  metadata: Record<string, string>;
}

export interface StripeSubscription {
  id: string;
  customerId: string;
  status: "active" | "canceled" | "past_due" | "trialing" | "incomplete";
  priceId: string;
  currentPeriodEnd: number;
  created: number;
  metadata: Record<string, string>;
}

// ─── Shopify Types ────────────────────────────────────────────────────────────

export interface ShopifyProduct {
  id: string;
  title: string;
  vendor: string;
  productType: string;
  status: "active" | "archived" | "draft";
  price: string;
  inventory: number;
  createdAt: string;
}

export interface ShopifyOrder {
  id: string;
  customerId?: string;
  lineItems: Array<{ productId: string; quantity: number; price: string }>;
  totalPrice: string;
  financialStatus: "pending" | "paid" | "refunded" | "partially_refunded";
  fulfillmentStatus: "unfulfilled" | "fulfilled" | "partial";
  createdAt: string;
}

export interface ShopifyCustomer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  ordersCount: number;
  createdAt: string;
}

// ─── Zendesk Types ────────────────────────────────────────────────────────────

export interface ZendeskUser {
  id: string;
  name: string;
  email: string;
  role: "end-user" | "agent" | "admin";
  createdAt: string;
}

export interface ZendeskTicket {
  id: string;
  subject: string;
  description: string;
  status: "new" | "open" | "pending" | "hold" | "solved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  requesterId?: string;
  assigneeId?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface ZendeskComment {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  public: boolean;
  createdAt: string;
}

// ─── Internal store shape ─────────────────────────────────────────────────────

interface StoreData {
  session: Session | null;
  stripe: {
    customers: Map<string, StripeCustomer>;
    paymentIntents: Map<string, StripePaymentIntent>;
    subscriptions: Map<string, StripeSubscription>;
  };
  shopify: {
    products: Map<string, ShopifyProduct>;
    orders: Map<string, ShopifyOrder>;
    customers: Map<string, ShopifyCustomer>;
  };
  zendesk: {
    users: Map<string, ZendeskUser>;
    tickets: Map<string, ZendeskTicket>;
    comments: Map<string, ZendeskComment>;
  };
}

// ─── Store class ──────────────────────────────────────────────────────────────

class DbStore {
  private data: StoreData;

  constructor() {
    this.data = this.emptyState();
  }

  private emptyState(): StoreData {
    return {
      session: null,
      stripe: {
        customers: new Map(),
        paymentIntents: new Map(),
        subscriptions: new Map(),
      },
      shopify: {
        products: new Map(),
        orders: new Map(),
        customers: new Map(),
      },
      zendesk: {
        users: new Map(),
        tickets: new Map(),
        comments: new Map(),
      },
    };
  }

  // ─── Session ───────────────────────────────────────────────────────────────

  startSession(scenarioId?: string): Session {
    const session: Session = {
      id: faker.string.uuid(),
      createdAt: new Date().toISOString(),
      scenarioId,
    };
    this.data.session = session;
    return session;
  }

  getSession(): Session | null {
    return this.data.session;
  }

  /** Wipe all data and clear the session. */
  reset(): void {
    this.data = this.emptyState();
  }

  // ─── Integration namespaces ────────────────────────────────────────────────
  // Tool files access entities directly through these getters.

  get stripe() {
    return this.data.stripe;
  }

  get shopify() {
    return this.data.shopify;
  }

  get zendesk() {
    return this.data.zendesk;
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  getStats() {
    return {
      sessionId: this.data.session?.id ?? null,
      stripe: {
        customers: this.data.stripe.customers.size,
        paymentIntents: this.data.stripe.paymentIntents.size,
        subscriptions: this.data.stripe.subscriptions.size,
      },
      shopify: {
        products: this.data.shopify.products.size,
        orders: this.data.shopify.orders.size,
        customers: this.data.shopify.customers.size,
      },
      zendesk: {
        users: this.data.zendesk.users.size,
        tickets: this.data.zendesk.tickets.size,
        comments: this.data.zendesk.comments.size,
      },
    };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const store = new DbStore();

// ─── ID helpers ───────────────────────────────────────────────────────────────
// Each integration uses a realistic ID prefix so agents get familiar-looking data.

export const newId = {
  stripeCustomer: () => `cus_${faker.string.alphanumeric(14)}`,
  stripePaymentIntent: () => `pi_${faker.string.alphanumeric(24)}`,
  stripeSubscription: () => `sub_${faker.string.alphanumeric(14)}`,
  stripePrice: () => `price_${faker.string.alphanumeric(14)}`,
  shopifyProduct: () => `gid://shopify/Product/${faker.number.int({ min: 1000000000, max: 9999999999 })}`,
  shopifyOrder: () => `gid://shopify/Order/${faker.number.int({ min: 1000000000, max: 9999999999 })}`,
  shopifyCustomer: () => `gid://shopify/Customer/${faker.number.int({ min: 1000000000, max: 9999999999 })}`,
  zendeskUser: () => String(faker.number.int({ min: 100000, max: 999999 })),
  zendeskTicket: () => String(faker.number.int({ min: 1000, max: 99999 })),
  zendeskComment: () => faker.string.uuid(),
};
