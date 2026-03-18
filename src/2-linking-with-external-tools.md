# Linking with External Tools

_Connecting Your MCP Server to the Outside World_

## Where We Left Off

In the previous chapter you built a **self-running MCP server** (`server.js`) with two tools — `add` and `greet` — and connected VS Code Copilot to it as the MCP host. Both tools were self-contained: they computed everything locally.

In this chapter we go further: your server's tools will call **external APIs and other MCP servers**, turning your server into a hub that bridges Copilot to the outside world.

```
Before:   VS Code Copilot → Your MCP Server → local logic
Now:      VS Code Copilot → Your MCP Server → external APIs / other MCP servers
```

## Part 1 - Calling an External API from a Tool

The simplest external link is calling a public HTTP API directly from inside a tool handler.

We will use **Open-Meteo** - a free, no-API-key-required weather API.

> 🔗 [open-meteo.com](https://open-meteo.com) - free, no sign-up, no API key, no rate limit for basic use.

No new packages needed - Node 18+ has `fetch` built in.

### Section 1 - The tool definition and schema

We'll register one tool in this part:

- **`get_weather`** — takes a `city` name and returns the current temperature and wind speed. It resolves the city to coordinates using Open-Meteo's free geocoding API, then fetches the current weather for those coordinates — two API calls, no key required.

```javascript
server.registerTool(
  "get_weather",
  {
    description: "Returns the current temperature for a given city by name",
    inputSchema: {
      city: z.string().describe("Name of the city"),
    },
  },
  async ({ city }) => {
    // handler - see Section 2
  },
);
```

The tool only needs a city name. The handler resolves coordinates internally using Open-Meteo's free geocoding API, so callers - including LLM agents - just say "Dubai" and the tool handles the rest.

### Section 2 - The handler: calling the external API

```javascript
async ({ city }) => {
  // Step 1: resolve city name to coordinates using Open-Meteo's free geocoding API
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
  const geoRes = await fetch(geoUrl);
  const geoData = await geoRes.json();
  if (!geoData.results?.length) {
    return { content: [{ type: "text", text: `City not found: ${city}` }] };
  }
  const { latitude, longitude } = geoData.results[0];

  // Step 2: fetch current weather for those coordinates
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}&current_weather=true`;

  const response = await fetch(url);
  const data = await response.json();

  const temp = data.current_weather.temperature;
  const wind = data.current_weather.windspeed;

  return {
    content: [
      {
        type: "text",
        text: `Weather in ${city}: ${temp}°C, wind ${wind} km/h`,
      },
    ],
  };
},
```

Two API calls, zero extra packages - both Open-Meteo endpoints are free with no key required. The client sees a normal tool response and has no idea what happened inside.

[View complete `server.js` in Source Code →](/code-states#state-3:server.js)

### Try it in Copilot Chat

Start the server (`node server.js`), then open the Command Palette and run **MCP: List Servers → Restart**. Then open Copilot Chat in **Agent mode** and ask:

> "What's the weather in Amsterdam?"

Copilot calls your `get_weather` tool and returns the result.

## Part 2 - Connecting to Another MCP Server over HTTP

This is the real power of MCP. Your server becomes a **client to another MCP server** - chaining them together over HTTP, with each process running independently.

```
Your Client → Your MCP Server :3000 → Downstream MCP Server :3001
```

We will build a **second MCP server** (`fs-server.js`) that exposes file system tools. Your main server (`server.js`) connects to it as a client and delegates tool calls to it.

### Step 1 - Install the filesystem MCP server package

```bash
npm install @modelcontextprotocol/server-filesystem
```

> 🔗 [npmjs.com/package/@modelcontextprotocol/server-filesystem](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem)

### Step 2 - Create fs-server.js

Create a new file called `fs-server.js` in your project folder.

```
devcon-workshop/
├── node_modules/
├── client.js
├── fs-server.js      ← new
├── package.json
├── package-lock.json
└── server.js
```

This is a standalone MCP server that wraps the filesystem server and exposes it over HTTP on port 3001.

#### The Imports - What Each One Does

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "node:http";
import { readdir, readFile } from "node:fs/promises";
```

| Import                          | What it does                                                    |
| ------------------------------- | --------------------------------------------------------------- |
| `McpServer`                     | Creates the downstream MCP server instance                      |
| `StreamableHTTPServerTransport` | Exposes it over HTTP - same pattern as your main server         |
| `z`                             | Validates tool inputs                                           |
| `http`                          | Node.js built-in HTTP server on port 3001                       |
| `readdir`, `readFile`           | Node built-ins to list and read files - no extra package needed |

#### Section 1 - Create the server factory and register file tools

We'll register one tool on the filesystem server:

- **`list_directory`** — takes an absolute `path` and returns a JSON array of the files and folders inside it, with each entry labelled as `file` or `dir`.

```javascript
function createServer() {
  const server = new McpServer({
    name: "devcon-filesystem-server",
    version: "1.0.0",
  });

  // Tool: list files in a directory
  server.registerTool(
    "list_directory",
    {
      description: "Lists all files and folders in a given directory path",
      inputSchema: {
        path: z.string().describe("Absolute path to the directory"),
      },
    },
    async ({ path: dirPath }) => {
      // Read the directory - withFileTypes:true gives us Dirent objects
      // so we can distinguish files from folders without a second stat() call
      const entries = await readdir(dirPath, { withFileTypes: true });

      // Return raw data as JSON; the caller decides how to format it
      const files = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(files) }],
      };
    },
  );

  return server;
}
```

#### Section 2 - Create the HTTP server and start on port 3001

```javascript
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

httpServer.listen(3001, () => {
  console.log("Filesystem MCP server running at http://localhost:3001/mcp");
});
```

[View complete `fs-server.js` in Source Code →](/code-states#state-4:fs-server.js)

### Step 3 - Connect your main server to the filesystem server over HTTP

Now update `server.js` to connect to `fs-server.js` as a downstream MCP server using `StreamableHTTPClientTransport` - consistent with everything else.

#### The new imports to add to server.js

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import path from "node:path";
```

| Import                          | What it does                                                               |
| ------------------------------- | -------------------------------------------------------------------------- |
| `Client`                        | MCP client - used here inside the server to connect downstream             |
| `StreamableHTTPClientTransport` | Connects to the filesystem server at `http://localhost:3001/mcp` over HTTP |
| `path`                          | Builds the absolute target path from the relative input                    |

#### Section 1 - Connect to the downstream server at startup

Add this before your `createServer` function in `server.js`:

```javascript
// Connect to the downstream filesystem MCP server over HTTP
const fsClient = new Client({
  name: "devcon-fs-bridge",
  version: "1.0.0",
});

await fsClient.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3001/mcp")),
);

console.log("Connected to filesystem MCP server.");
```

This runs once at startup and keeps the connection open for all subsequent tool calls.

#### Section 2 - Add a delegating tool

We'll add one tool to the main server that bridges through to the filesystem server:

- **`list_project_files`** — takes an optional relative `path` within the project folder and returns its contents by delegating the call to `list_directory` on the downstream filesystem server. The caller only sees a normal tool response — the inter-server HTTP call is invisible to them.

```javascript
server.registerTool(
  "list_project_files",
  {
    description:
      "Lists all files in the workshop project folder by delegating to the filesystem server",
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

    // Delegate to the downstream filesystem MCP server
    const result = await fsClient.callTool({
      name: "list_directory",
      arguments: { path: targetPath },
    });

    // fs-server returns a JSON array; format it here
    const entries = JSON.parse(result.content[0].text);
    const lines = entries.map((e) => `[${e.type.toUpperCase()}] ${e.name}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);
```

Your client calls `list_project_files` on your server. Your server calls `list_directory` on the filesystem server. The result flows back up. Three independent processes, all communicating over HTTP.

[View complete `server.js` in Source Code →](/code-states#state-4:server.js)

## Run It

Start both servers (two terminals):

```bash
# Terminal 1 - start the filesystem server first
node fs-server.js

# Terminal 2 - start the main server (connects to :3001 on startup)
node server.js
```

Run **MCP: List Servers → Restart** in the Command Palette to reconnect VS Code to the updated server.

> "Use `#list_project_files` to show me the files in my project."

Copilot calls `list_project_files` on the main server, which delegates to the filesystem server across HTTP — three processes, zero manual coordination.

## Challenge

Add a `read_file` tool to `server.js` that delegates to `fs-server.js`'s `read_file` tool and returns the content of `package.json`.

[View complete solution `fs-server.js` in Source Code →](/code-states#state-5:fs-server.js)

[View complete solution `server.js` in Source Code →](/code-states#state-5:server.js)
