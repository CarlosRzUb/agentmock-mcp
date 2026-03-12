// ─── Stripe error shape ───────────────────────────────────────────────────────

export interface StripeErrorPayload {
  error: {
    type: "card_error" | "api_error" | "invalid_request_error";
    code: string;
    message: string;
    decline_code?: string;
    param?: string;
    doc_url?: string;
  };
}

export interface ScenarioEntry {
  /** Realistic Stripe error payload returned when this scenario fires. */
  stripeError: StripeErrorPayload;
  /** HTTP status code — used by the Pro-tier HTTP bridge. */
  httpStatus: number;
}

// ─── Scenario registry ────────────────────────────────────────────────────────
// Each key is a scenario ID that can be set on a session OR used as a direct
// trigger token in a tool call. Values are realistic Stripe error objects.

export const SCENARIOS: Record<string, ScenarioEntry> = {
  // ── Card errors ─────────────────────────────────────────────────────────────

  payment_declined: {
    httpStatus: 402,
    stripeError: {
      error: {
        type: "card_error",
        code: "card_declined",
        decline_code: "generic_decline",
        message: "Your card was declined.",
        doc_url: "https://stripe.com/docs/error-codes/card-declined",
      },
    },
  },

  insufficient_funds: {
    httpStatus: 402,
    stripeError: {
      error: {
        type: "card_error",
        code: "card_declined",
        decline_code: "insufficient_funds",
        message: "Your card has insufficient funds.",
        doc_url: "https://stripe.com/docs/error-codes/card-declined",
      },
    },
  },

  invalid_cvc: {
    httpStatus: 402,
    stripeError: {
      error: {
        type: "card_error",
        code: "incorrect_cvc",
        message: "Your card's security code is incorrect.",
        param: "cvc",
        doc_url: "https://stripe.com/docs/error-codes/incorrect-cvc",
      },
    },
  },

  expired_card: {
    httpStatus: 402,
    stripeError: {
      error: {
        type: "card_error",
        code: "expired_card",
        message: "Your card has expired.",
        param: "exp_month",
        doc_url: "https://stripe.com/docs/error-codes/expired-card",
      },
    },
  },

  // ── API errors ──────────────────────────────────────────────────────────────

  rate_limit_exceeded: {
    httpStatus: 429,
    stripeError: {
      error: {
        type: "api_error",
        code: "rate_limit",
        message:
          "Too many requests made to the API too quickly. See https://stripe.com/docs/rate-limits",
      },
    },
  },
};

// ─── Test token aliases ───────────────────────────────────────────────────────
// Maps Stripe-style test tokens to scenario keys.
// Mirrors https://stripe.com/docs/testing#declined-payments so developers
// already know the token names from their real Stripe experience.

const TOKEN_ALIASES: Record<string, string> = {
  tok_chargeDeclined: "payment_declined",
  tok_chargeDeclinedInsufficientFunds: "insufficient_funds",
  tok_chargeDeclinedIncorrectCvc: "invalid_cvc",
  tok_chargeDeclinedExpiredCard: "expired_card",
};

// ─── resolveScenario ──────────────────────────────────────────────────────────

/**
 * Determines whether a call should return an error instead of a happy-path
 * response. Checks two layers in order:
 *
 *   1. Inline token  — e.g. `payment_method: "tok_chargeDeclined"` passed
 *      directly in the tool call. Takes priority over everything else.
 *   2. Session scenario — the `scenarioId` stored on the active session.
 *      Fires for every call while the scenario is active.
 *
 * Returns a Stripe-shaped error payload, or `null` for the happy path.
 */
export function resolveScenario(
  token?: string,
  scenarioId?: string
): StripeErrorPayload | null {
  // Layer 1: inline test token
  if (token) {
    const key = TOKEN_ALIASES[token] ?? token;
    const entry = SCENARIOS[key];
    if (entry) return entry.stripeError;
  }

  // Layer 2: session-level scenario
  if (scenarioId) {
    const entry = SCENARIOS[scenarioId];
    if (entry) return entry.stripeError;
  }

  return null;
}
