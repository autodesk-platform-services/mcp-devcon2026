import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import http from "node:http";
import path from "node:path";

// Downstream clients — connect once at startup
const fsClient = new Client({ name: "devcon-fs-bridge", version: "1.0.0" });
await fsClient.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3001/mcp")),
);
console.log("Connected to filesystem MCP server at :3001");

const apsClient = new Client({ name: "devcon-aps-bridge", version: "1.0.0" });
await apsClient.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3002/mcp")),
);
console.log("Connected to APS MCP server at :3002");

// Factory: fresh McpServer per request
function createServer() {
  const server = new McpServer({
    name: "devcon-workshop-server",
    version: "2.0.0",
  });

  // Tool 1: add
  server.registerTool(
    "add",
    {
      description: "Adds two numbers together",
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({
      content: [{ type: "text", text: `Result: ${a + b}` }],
    }),
  );

  // Tool 2: greet
  server.registerTool(
    "greet",
    {
      description: "Returns a greeting in the chosen language",
      inputSchema: {
        name: z.string(),
        language: z.enum(["english", "french", "spanish"]),
      },
    },
    async ({ name, language }) => {
      const greetings = {
        english: `Hello, ${name}! Welcome to the DevCon MCP Workshop.`,
        french: `Bonjour, ${name} ! Bienvenue au Workshop MCP DevCon.`,
        spanish: `¡Hola, ${name}! Bienvenido al Workshop MCP de DevCon.`,
      };
      return { content: [{ type: "text", text: greetings[language] }] };
    },
  );

  // Tool 3: get_weather
  server.registerTool(
    "get_weather",
    {
      description: "Returns the current temperature for a given city by name",
      inputSchema: { city: z.string().describe("Name of the city") },
    },
    async ({ city }) => {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
      );
      const geoData = await geoRes.json();
      if (!geoData.results?.length)
        return { content: [{ type: "text", text: `City not found: ${city}` }] };
      const { latitude, longitude } = geoData.results[0];
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`,
      );
      const data = await res.json();
      const { temperature: temp, windspeed: wind } = data.current_weather;
      return {
        content: [
          {
            type: "text",
            text: `Weather in ${city}: ${temp}°C, wind ${wind} km/h`,
          },
        ],
      };
    },
  );

  // Tool 4: list_project_files
  server.registerTool(
    "list_project_files",
    {
      description: "Lists all files in the workshop project folder",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Relative path within the project (optional)"),
      },
    },
    async ({ path: relativePath }) => {
      const targetPath = relativePath
        ? path.join(process.cwd(), relativePath)
        : process.cwd();
      const result = await fsClient.callTool({
        name: "list_directory",
        arguments: { path: targetPath },
      });
      const entries = JSON.parse(result.content[0].text);
      const lines = entries.map((e) => `[${e.type.toUpperCase()}] ${e.name}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // Tool 5: aps_list_buckets
  server.registerTool(
    "aps_list_buckets",
    {
      description: "Lists all OSS storage buckets in the connected APS account",
      inputSchema: {
        region: z
          .enum(["US", "EMEA", "AUS", "CAN", "DEU", "IND", "JPN", "GBR"])
          .describe("Data center region to list buckets from"),
      },
    },
    async ({ region }) => {
      const result = await apsClient.callTool({
        name: "list_buckets",
        arguments: { region },
      });
      return { content: result.content };
    },
  );

  // Tool 6: aps_create_bucket
  server.registerTool(
    "aps_create_bucket",
    {
      description:
        "Creates a new OSS storage bucket in the connected APS account",
      inputSchema: {
        bucket_key: z
          .string()
          .describe("Unique key for the bucket (lowercase, numbers, dashes)"),
        policy: z.enum(["transient", "temporary", "persistent"]),
        region: z.enum([
          "US",
          "EMEA",
          "AUS",
          "CAN",
          "DEU",
          "IND",
          "JPN",
          "GBR",
        ]),
      },
    },
    async ({ bucket_key, policy, region }) => {
      const result = await apsClient.callTool({
        name: "create_bucket",
        arguments: {
          bucket_key,
          policy,
          region,
        },
      });
      return { content: result.content };
    },
  );

  return server;
}

// Create HTTP server and start on port 3000
const httpServer = http.createServer(async (req, res) => {
  if (req.url !== "/mcp") {
    res.writeHead(404).end("Not found");
    return;
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => transport.close());
  const server = createServer();
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(3000, () => {
  console.log("Main MCP server running at http://localhost:3000/mcp");
});
