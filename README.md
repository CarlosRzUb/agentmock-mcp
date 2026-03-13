# AgentMock MCP

A stateful mock API server for AI agent developers. Test your agents against realistic fake integrations — Stripe, Shopify, Zendesk — without touching production data or needing real API keys.

Stop letting your Stripe sandbox rack up test charges. Stop writing brittle hand-rolled fixtures. AgentMock gives your agent a fully stateful fake Stripe it can create customers, charge cards, and trigger failures against — all locally, all in seconds.

---

## Why AgentMock?

When building AI agents that interact with payment processors or CRMs, you need a sandbox that:

- Returns realistic, correctly-shaped responses your agent can actually parse
- Lets you simulate failure scenarios (card declined, rate limits, missing resources) on demand
- Keeps state between calls so multi-step flows work end to end
- Never risks billing real customers or sending real emails

AgentMock provides all of this with zero configuration.

---

## Quick start

**Prerequisites:** Node.js 22+

### 1. Clone and install

```bash
git clone https://github.com/CarlosRzUb/agentmock-mcp.git
cd agentmock-mcp
npm install
```

### 2. Register the server

Pick the client you use:

#### Claude Code (terminal)

```bash
claude mcp add agentmock node --import tsx/esm /absolute/path/to/agentmock-mcp/src/server.ts
```

Verify it's connected:

```bash
claude mcp list
```

You should see `agentmock` in the list. Then just start a session — the tools are available immediately.

> **Windows users:** if you see a spawn error, use the full path to `node.exe` (e.g. `C:\Program Files\nodejs\node.exe`) instead of `node`.

#### Claude Desktop

Open your config file:

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

### 3. Verify it's working

Ask Claude: *"ping the AgentMock server"* — you should get a pong with a timestamp back.

---

## Available tools

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

| Scenario ID | Error type | Description |
|---|---|---|
| `payment_declined` | `card_error` | Generic card decline |
| `insufficient_funds` | `card_error` | Card declined — insufficient funds |
| `invalid_cvc` | `card_error` | Incorrect CVC code |
| `expired_card` | `card_error` | Card expired |
| `rate_limit_exceeded` | `api_error` | Too many requests |

Call `set_mock_scenario` with no `scenarioId` to return to the happy path.

### Inline test tokens

For `stripe_create_payment_intent`, pass a test token as `payment_method` to trigger a one-off error without changing the global scenario. These mirror Stripe's own test token names:

| Token | Triggers |
|---|---|
| `tok_chargeDeclined` | `payment_declined` |
| `tok_chargeDeclinedInsufficientFunds` | `insufficient_funds` |
| `tok_chargeDeclinedIncorrectCvc` | `invalid_cvc` |
| `tok_chargeDeclinedExpiredCard` | `expired_card` |

Inline tokens take priority over any active session scenario.

---

## Development

```bash
npm run dev      # Run the MCP server with hot reload
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
    express.ts           # HTTP bridge (future cloud hosting)
```

---

## 🚀 Roadmap / Coming Soon

- [ ] **Shopify** — products, orders, customers
- [ ] **Zendesk** — tickets, users, comments
- [ ] **Cloud Hosting** — 24/7 uptime for teams, no local setup required
- [ ] **Async Webhook Simulation** — trigger `payment_intent.succeeded`, `invoice.payment_failed`, and other events to test your webhook handlers end to end

---

## License

ISC
