import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { store } from "../db/store.js";
import { SCENARIOS } from "../scenarios/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Exported for direct testing — registered below via registerSessionTools.
export async function setMockScenarioHandler(input: {
  scenarioId?: string;
}): Promise<CallToolResult> {
  const { scenarioId } = input;

  if (scenarioId !== undefined) {
    const validKeys = Object.keys(SCENARIOS);
    if (!validKeys.includes(scenarioId)) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown scenario: "${scenarioId}". Valid values are: ${validKeys.join(", ")}`,
          },
        ],
        isError: true,
      };
    }
    store.startSession(scenarioId);
    return {
      content: [{ type: "text", text: `Active scenario set to: ${scenarioId}` }],
    };
  }

  store.startSession();
  return {
    content: [
      { type: "text", text: "Active scenario cleared. Running in happy path mode." },
    ],
  };
}

export function registerSessionTools(server: McpServer): void {
  server.tool(
    "set_mock_scenario",
    "Set or clear the active mock scenario. When active, ALL tools return realistic Stripe error payloads. Valid IDs: payment_declined, insufficient_funds, invalid_cvc, expired_card, rate_limit_exceeded. Omit scenarioId to reset to happy path.",
    {
      scenarioId: z
        .string()
        .optional()
        .describe(
          "Scenario to activate. One of: payment_declined, insufficient_funds, invalid_cvc, expired_card, rate_limit_exceeded. Omit to reset to happy path."
        ),
    },
    setMockScenarioHandler
  );
}
