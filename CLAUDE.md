# AgentMock MCP — Project Guide for Claude Code

## What this project is
An MCP (Model Context Protocol) server that generates stateful mock APIs and synthetic databases on the fly. AI developers use it to safely test their agents against fake integrations (Stripe, Shopify, Zendesk) without touching production data.

- **Free tier**: local MCP server (stdio transport)
- **Pro tier**: cloud-hosted HTTP bridge (Express.js)

## Stack
- Language: TypeScript (strict mode)
- Runtime: Node.js 22
- MCP SDK: @modelcontextprotocol/sdk
- Fake data: @faker-js/faker
- HTTP bridge: express
- Module system: ESM ("type": "module" in package.json)

## Project structure
```
src/
  server.ts          # Entry point — creates MCP server, registers tools, starts stdio transport
  db/
    store.ts         # In-memory stateful database (sessions, entities, relationships)
  tools/
    stripe.ts        # Mock Stripe tools (customers, payments, subscriptions)
    shopify.ts       # Mock Shopify tools (products, orders, customers)
    zendesk.ts       # Mock Zendesk tools (tickets, users, comments)
  scenarios/
    index.ts         # Scenario state machines (e.g. "payment_declined", "rate_limit_hit")
  bridge/
    express.ts       # HTTP API for Pro/Cloud tier
```

## Dev commands
- `npm run dev` — run server in development (no compile step, uses tsx)
- `npm run build` — compile TypeScript to dist/
- `npm start` — run compiled production build

## Key rules
- NEVER use console.log — stdout is reserved for MCP protocol. Use console.error for debug output.
- All tool parameters must be validated with Zod (already included in MCP SDK).
- Keep tools focused: one file per integration in src/tools/.
- The in-memory store (store.ts) is the single source of truth for all mock state.

## MCP Servers & Plugins (all configured)
- serena: semantic code analysis (LSP) — token saver
- context7: live docs for MCP SDK, faker, express — token saver
- github: repo management via @modelcontextprotocol/server-github
- VS Code: ESLint + Prettier installed
- Sentry MCP: add after deployment (Phase 4)

## Current build status
- [x] Project scaffolding
- [x] package.json, tsconfig.json
- [x] src/server.ts with ping + get_server_info tools
- [x] src/db/store.ts — typed entities, Maps per integration, session mgmt, newId helpers
- [x] src/tools/stripe.ts
- [x] src/tools/session.ts
- [x] src/scenarios/index.ts
- [x] src/bridge/express.ts

## Post-MVP / Future Scope
- [ ] src/tools/shopify.ts
- [ ] src/tools/zendesk.ts

## Monetization plan
- Free tier: local stdio MCP server (open source / free download)
- Pro tier: cloud-hosted, accessed via HTTP, gated by API key + Lemon Squeezy billing
- Deployment target: Railway or Render
- Billing: Lemon Squeezy (Merchant of Record — handles EU VAT automatically)
- Legal entity: Spanish autónomo under Tarifa Plana / Cuota Cero (Valencia)
