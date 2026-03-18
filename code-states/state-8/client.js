import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
);

const client = new Client({
  name: "devcon-workshop-client",
  version: "1.0.0",
});

await client.connect(transport);
console.log("Connected to MCP server.");

const { tools } = await client.listTools();
console.log("\nAvailable tools:");
tools.forEach((tool) => {
  console.log(`  - ${tool.name}: ${tool.description}`);
});

// Chapter 01 — add
const addResult = await client.callTool({
  name: "add",
  arguments: { a: 12, b: 30 },
});
console.log("\nadd(12, 30):", addResult.content[0].text);

// Chapter 01 — greet
const greetResult = await client.callTool({
  name: "greet",
  arguments: { name: "Nabil", language: "french" },
});
console.log("greet():", greetResult.content[0].text);

// Chapter 01 — bim_element
const bimResult = await client.callTool({
  name: "bim_element",
  arguments: { id: "W-001", type: "Wall", material: "Concrete", level: "L1" },
});
console.log("bim_element():", bimResult.content[0].text);

// Chapter 02 — get_weather
const weatherResult = await client.callTool({
  name: "get_weather",
  arguments: { city: "Amsterdam" },
});
console.log("get_weather():", weatherResult.content[0].text);

// Chapter 02 — list_project_files (delegates to fs-server)
const filesResult = await client.callTool({
  name: "list_project_files",
  arguments: {},
});
console.log("\nlist_project_files():\n", filesResult.content[0].text);

// Chapter 02 challenge — read_file (delegates to fs-server)
const readResult = await client.callTool({
  name: "read_file",
  arguments: { path: "package.json" },
});
console.log("\nread_file(package.json):\n", readResult.content[0].text);

await client.close();
