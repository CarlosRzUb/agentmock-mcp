# AgentMock MCP

A stateful mock API server for AI agent developers. Test your agents against realistic fake integrations — Stripe, Shopify, Zendesk — without touching production data or needing real API keys.

- **Free tier** — runs locally as an MCP server (stdio transport), connects directly to Claude Desktop or any MCP-compatible client
- **Pro tier** — cloud-hosted HTTP bridge, accessible from anywhere via REST

---

## Why AgentMock?

When building AI agents that interact with payment processors or CRMs, you need a sandbox that:

- Returns realistic, correctly-shaped responses your agent can actually parse
- Lets you simulate failure scenarios (card declined, rate limits, missing resources) on demand
- Keeps state between calls so multi-step flows work end to end
- Never risks billing real customers or sending real emails

AgentMock provides all of this with zero configuration.

---

## Quick start (Free tier — local MCP)

**Prerequisites:** Node.js 22+

### 1. Clone and install

```bash
git clone https://github.com/CarlosRzUb/agentmock-mcp.git
cd agentmock-mcp
npm install
```

### 2. Add to Claude Desktop

Open your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the following inside `"mcpServers"`:

```json
{
  "mcpServers": {
    "agentmock": {
      "command": "node",
      "args": ["--import", "tsx/esm", "/absolute/path/to/agentmock-mcp/src/server.ts"]
    }
  }
}
```

Replace `/absolute/path/to/agentmock-mcp` with the actual path on your machine.

### 3. Restart Claude Desktop

AgentMock tools will appear automatically. Ask Claude: *"ping the AgentMock server"* to verify it's working.

---

## Pro tier — HTTP bridge

The Pro tier exposes a Stripe-compatible REST API. You can point any Stripe SDK at it by swapping the base URL.

### Run locally

```bash
AGENTMOCK_API_KEY=your-secret-key npm run bridge
# Server starts at http://localhost:3000
```

### Deploy to Railway

This repo is Railway-ready. Set one environment variable in your Railway project:

| Variable | Value |
|---|---|
| `AGENTMOCK_API_KEY` | Any secret string — used to authenticate all requests |

Railway will automatically run `npm run build` then `npm start`.

### Authenticate

All requests must include the API key as a Bearer token:

```
Authorization: Bearer your-secret-key
```

---

## Available tools (Free tier MCP)

### `ping`
Check if the server is alive. Returns a pong with a timestamp.

### `get_server_info`
Returns server metadata and available integrations.

### `set_mock_scenario`
Activate a failure scenario. Once set, **every subsequent tool call** returns the corresponding error until you clear it.

```
scenarioId  — one of the scenario IDs listed below, or omit to reset to happy path
```

### Stripe tools

| Tool | Description |
|---|---|
| `stripe_create_customer` | Create a customer (`cus_...` ID) |
| `stripe_retrieve_customer` | Fetch a customer by ID |
| `stripe_list_customers` | List customers (default limit: 10) |
| `stripe_create_payment_intent` | Create a payment intent (`pi_...` ID) |
| `stripe_retrieve_payment_intent` | Fetch a payment intent by ID |
| `stripe_list_payment_intents` | List payment intents, optionally filtered by `customer_id` |
| `stripe_create_subscription` | Create a subscription (`sub_...` ID) — customer must exist |
| `stripe_retrieve_subscription` | Fetch a subscription by ID |
| `stripe_list_subscriptions` | List subscriptions, optionally filtered by `customer_id` |

---

## Failure scenarios

Activate any scenario with `set_mock_scenario` to make all tools return a realistic error.

| Scenario ID | Error type | HTTP status | Description |
|---|---|---|---|
| `payment_declined` | `card_error` | 402 | Generic card decline |
| `insufficient_funds` | `card_error` | 402 | Card declined — insufficient funds |
| `invalid_cvc` | `card_error` | 402 | Incorrect CVC code |
| `expired_card` | `card_error` | 402 | Card expired |
| `rate_limit_exceeded` | `api_error` | 429 | Too many requests |

Call `set_mock_scenario` with no `scenarioId` to return to the happy path.

### Inline test tokens

For `stripe_create_payment_intent` only, you can trigger a one-off error by passing a test token as `payment_method`. These mirror Stripe's own test token names:

| Token | Triggers |
|---|---|
| `tok_chargeDeclined` | `payment_declined` |
| `tok_chargeDeclinedInsufficientFunds` | `insufficient_funds` |
| `tok_chargeDeclinedIncorrectCvc` | `invalid_cvc` |
| `tok_chargeDeclinedExpiredCard` | `expired_card` |

Inline tokens take priority over any active session scenario.

---

## HTTP bridge endpoints (Pro tier)

Base URL: your Railway deployment URL (or `http://localhost:3000` locally).

All endpoints are Stripe API-compatible in shape.

### Customers

```
POST   /v1/customers
GET    /v1/customers/:id
GET    /v1/customers?limit=10
```

### Payment Intents

```
POST   /v1/payment_intents
GET    /v1/payment_intents/:id
GET    /v1/payment_intents?customer=cus_...&limit=10
```

### Subscriptions

```
POST   /v1/subscriptions
GET    /v1/subscriptions/:id
GET    /v1/subscriptions?customer=cus_...&limit=10
```

### Scenario control

```
POST   /agentmock/scenario
Body:  { "scenarioId": "payment_declined" }   — activate a scenario
Body:  {}                                      — reset to happy path
```

### Using the Stripe SDK against AgentMock

```typescript
import Stripe from "stripe";

const stripe = new Stripe("any-string", {
  apiVersion: "2024-06-20",
  baseURL: "https://your-railway-app.railway.app",
  httpClient: Stripe.createFetchHttpClient(),
});

// Works exactly like the real Stripe SDK
const customer = await stripe.customers.create({
  email: "test@example.com",
  name: "Jane Doe",
});
```

---

## Development

```bash
npm run dev      # Run the MCP server (stdio) with hot reload
npm run bridge   # Run the HTTP bridge locally
npm run build    # Compile TypeScript → dist/
npm test         # Run tests
npm run test:watch    # Watch mode
```

---

## Project structure

```
src/
  server.ts              # MCP server entry point
  db/
    store.ts             # In-memory stateful database
  tools/
    stripe.ts            # Stripe tool handlers + MCP registration
    session.ts           # set_mock_scenario tool
  scenarios/
    index.ts             # Scenario registry + resolveScenario logic
  bridge/
    express.ts           # HTTP bridge (Pro tier)
```

---

## Roadmap

- [x] Stripe — customers, payment intents, subscriptions
- [ ] Shopify — products, orders, customers
- [ ] Zendesk — tickets, users, comments
- [ ] API key gating + Lemon Squeezy billing for Pro tier

---

## License

ISC
