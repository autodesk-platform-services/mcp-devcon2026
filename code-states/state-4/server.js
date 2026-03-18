import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import http from "node:http";
import path from "node:path";

// Downstream client — connect to the filesystem server at startup
const fsClient = new Client({ name: "devcon-fs-bridge", version: "1.0.0" });
await fsClient.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3001/mcp")),
);
console.log("Connected to filesystem MCP server at :3001");

function createServer() {
  const server = new McpServer({
    name: "devcon-workshop-server",
    version: "1.0.0",
  });

  // Tool 1: add
  server.registerTool(
    "add",
    {
      description: "Adds two numbers together",
      inputSchema: {
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
      },
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
        name: z.string().describe("Name of the person to greet"),
        language: z
          .enum(["english", "french", "spanish"])
          .describe("Language for the greeting"),
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

  // Tool 3: bim_element
  server.registerTool(
    "bim_element",
    {
      description: "Returns a formatted summary of a BIM element",
      inputSchema: {
        id: z.string().describe("Element ID, e.g. W-001"),
        type: z.string().describe("Element type, e.g. Wall"),
        material: z.string().describe("Material, e.g. Concrete"),
        level: z.string().describe("Level, e.g. L1"),
      },
    },
    async ({ id, type, material, level }) => ({
      content: [
        {
          type: "text",
          text: `[${id}] ${type} | Material: ${material} | Level: ${level}`,
        },
      ],
    }),
  );

  // Tool 4: get_weather
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

  // Tool 5: list_project_files (delegates to fs-server via MCP chaining)
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

  return server;
}

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
