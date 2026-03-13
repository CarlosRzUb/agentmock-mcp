import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSessionTools } from "./tools/session.js";
import { registerStripeTools } from "./tools/stripe.js";

// --- Server Definition ---
// McpServer is the main class from the official SDK.
// We give it a name and version — Claude Desktop displays these.
const server = new McpServer({
  name: "agentmock-mcp",
  version: "0.1.0",
});

// --- Tools ---
// A "tool" is a function that an AI agent can call by name.
// Each tool has: a name, a description (the AI reads this to decide when to use it),
// input parameters defined with Zod (a validation library), and a handler function.

// TOOL: ping
// The simplest possible tool. Used to verify the server is alive and responding.
server.tool(
  "ping",
  "Check if the AgentMock MCP server is running. Returns a pong response with a timestamp.",
  {}, // No input parameters needed
  async () => {
    return {
      content: [
        {
          type: "text",
          text: `pong — AgentMock MCP is alive. Timestamp: ${new Date().toISOString()}`,
        },
      ],
    };
  }
);

// TOOL: get_server_info
// Returns metadata about the server and which mock integrations are available.
// Useful for AI agents to discover capabilities before making calls.
server.tool(
  "get_server_info",
  "Returns information about this AgentMock MCP server, including available mock integrations and the current session state.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              server: "agentmock-mcp",
              version: "0.1.0",
              status: "running",
              availableIntegrations: ["stripe", "shopify", "zendesk"],
              tier: "free",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Integration tool registration ---
registerSessionTools(server);
registerStripeTools(server);

// --- Transport & Start ---
// StdioServerTransport connects the server to Claude Desktop via stdin/stdout.
// This is how Claude Desktop "talks" to our server process.
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Note: do NOT use console.log here — stdout is reserved for MCP protocol messages.
  // Use stderr for any debug output.
  console.error("AgentMock MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
