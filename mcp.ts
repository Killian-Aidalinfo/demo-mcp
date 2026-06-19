import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";

// Create server instance
const server = new McpServer({
  name: "weather",
  version: "1.0.0",
});

server.registerTool(
  "testTool",
  {
    description: "test tool",
    // inputSchema / outputSchema attendent un « raw shape » Zod
    // (un objet de champs), PAS un z.object(...).
    inputSchema: {
      name: z.string().describe("Your name"),
    },
    outputSchema: {
      output: z.string(),
    },
  },
  // Le handler reçoit les arguments déjà parsés/validés.
  async ({ name }) => {
    // ⚠️ stdio : ne JAMAIS écrire sur stdout (réservé au JSON-RPC).
    //    On log donc sur stderr avec console.error.
    console.error("Hello from testTool handler", name);

    const output = `Hello, ${name}!`;
    return {
      // `content` = sortie lisible (obligatoire)
      content: [{ type: "text", text: output }],
      // `structuredContent` = sortie typée conforme à outputSchema
      structuredContent: { output },
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Weather MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
