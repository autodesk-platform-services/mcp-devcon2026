# Advanced — Custom Client and LLM Agent

_Building the Loop That Powers Every AI Product_

## Introduction

Throughout this workshop VS Code Copilot acted as your MCP host — it connected to your servers, discovered the tools, and called them in response to natural language. That loop is not magic. In this chapter you will build it yourself, in two stages:

1. **`client.js`** — a programmatic MCP client that connects to your servers and calls every tool you have built across the workshop, so you can see the full picture in one place.
2. **`agent.js`** — a Gemini-powered agent that drives the same client with a natural language loop: receive a prompt, discover tools, call the right ones, synthesise an answer.

By the end you will have a complete working agent and a clear mental model of what every AI coding assistant, chat interface, and automation tool is doing under the hood.

## Prerequisites

Make sure you have completed Chapters 01–03. Your project folder should look like this:

```
devcon-workshop/
├── .vscode/
│   └── mcp.json
├── node_modules/
├── .env
├── aps-server.js
├── fs-server.js
├── package.json
├── package-lock.json
└── server.js
```

## Part 1 - Build client.js

`client.js` is a standalone script that connects directly to your MCP server and calls tools programmatically — no VS Code, no Copilot. This is useful for scripting, testing, and as the base for building `agent.js`.

Create a new file called `client.js` in your project folder.

### The Imports - What Each One Does

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
```

| Import                          | What it does                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Client`                        | The MCP client class. Manages the connection to the server and exposes methods like `listTools()` and `callTool()`.                 |
| `StreamableHTTPClientTransport` | Connects the client to a remote MCP server over HTTP. Sends JSON-RPC messages via POST and can receive streaming responses via SSE. |

### Section 1 - Connect to the server

```javascript
const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
);

const client = new Client({
  name: "devcon-workshop-client",
  version: "1.0.0",
});

await client.connect(transport);
console.log("Connected to MCP server.");
```

`client.connect()` triggers the MCP handshake — the client and server exchange names, versions, and supported capabilities. After this call the connection is ready.

### Section 2 - Discover available tools

```javascript
const { tools } = await client.listTools();
console.log("\nAvailable tools:");
tools.forEach((tool) => {
  console.log(`  - ${tool.name}: ${tool.description}`);
});
```

`listTools()` asks the server to advertise everything it can do. This is one of MCP's core features: capabilities are **discovered at runtime**, not hardcoded into the client.

### Section 3 - Call every tool from the workshop

```javascript
// Chapter 01 — add
const addResult = await client.callTool({
  name: "add",
  arguments: { a: 12, b: 30 },
});
console.log("\nadd(12, 30):", addResult.content[0].text);

// Chapter 01 — greet
const greetResult = await client.callTool({
  name: "greet",
  arguments: { name: "Nabil", language: "spanish" },
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

// Chapter 03 — aps_create_bucket then aps_list_buckets
const createResult = await client.callTool({
  name: "aps_create_bucket",
  arguments: {
    bucket_key: "devcon-test-US",
    policy: "persistent",
    region: "US",
  },
});
console.log("\naps_create_bucket():\n", createResult.content[0].text);

const bucketsResult = await client.callTool({
  name: "aps_list_buckets",
  arguments: { region: "US" },
});
console.log("\naps_list_buckets():\n", bucketsResult.content[0].text);

await client.close();
```

### Run It

Start all three servers, then run the client:

```bash
# Terminal 1
node fs-server.js

# Terminal 2
node aps-server.js

# Terminal 3
node server.js

# Terminal 4
node client.js
```

[View complete `client.js` in Source Code →](/code-states#state-8:client.js)

---

## Part 2 - Get a Free Gemini API Key

Gemini's free tier is available through Google AI Studio. No credit card required — just a Google account.

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with your Google account
3. Click **Get API key** → **Create API key**
4. Copy the key

Add it to your `.env` file:

```bash
GEMINI_API_KEY="your-key-here"
```

> The Gemini 2.5 Flash (`gemini-2.5-flash`) free tier gives you 5 requests per minute and 20 requests per day, more than enough for this workshop.

## Part 3 - Install the Gemini SDK

```bash
npm install @google/genai
```

> 🔗 [npmjs.com/package/@google/genai](https://www.npmjs.com/package/@google/genai) - Google's official JS/TS SDK for Gemini. Supports function calling and has experimental native MCP support.

## Part 4 - Build agent.js

Create a new file called `agent.js`. This replaces the hardcoded `callTool()` calls in `client.js` with a natural language loop driven by Gemini.

```
devcon-workshop/
├── .vscode/
│   └── mcp.json
├── node_modules/
├── .env
├── agent.js          ← new
├── aps-server.js
├── client.js
├── fs-server.js
├── package.json
├── package-lock.json
└── server.js
```

### The Imports - What Each One Does

```javascript
import { GoogleGenAI } from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
```

| Import                          | What it does                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GoogleGenAI`                   | The Gemini client. Sends prompts to the model and receives responses, including `functionCall` objects when the model wants to use a tool. |
| `Client`                        | The MCP client — same as in `client.js`. Connects to `server.js` and calls tools on behalf of the LLM.                                     |
| `StreamableHTTPClientTransport` | Connects the MCP client to `server.js` at `http://localhost:3000/mcp` over HTTP.                                                           |

### Section 1 - Connect to the MCP Server and Discover Tools

```javascript
const mcpClient = new Client({
  name: "devcon-agent",
  version: "1.0.0",
});

await mcpClient.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3000/mcp")),
);

const { tools } = await mcpClient.listTools();
console.log(`Connected. ${tools.length} tools available:`);
tools.forEach((t) => console.log(`  - ${t.name}: ${t.description}`));
```

This is identical to `client.js` — the agent discovers tools dynamically at runtime, not from a hardcoded list.

### Section 2 - Convert MCP Tools to Gemini Function Declarations

Gemini's function calling API expects tools in a specific JSON schema format. We convert from MCP's `inputSchema` format to Gemini's `functionDeclarations` format:

```javascript
const geminiTools = [
  {
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })),
  },
];
```

This is the bridge between MCP and the LLM. The tool names and descriptions your MCP server advertises become the function names and descriptions that Gemini uses to decide which tool to call. **The quality of your tool descriptions directly affects how well the LLM chooses.**

### Section 3 - The Tool-Calling Loop

```javascript
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function ask(userPrompt) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`User: ${userPrompt}\n`);

  const messages = [{ role: "user", parts: [{ text: userPrompt }] }];

  while (true) {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: messages,
      config: { tools: geminiTools, temperature: 0 },
    });

    const candidate = response.candidates[0].content;
    const toolCallParts = candidate.parts.filter((p) => p.functionCall);

    if (toolCallParts.length === 0) {
      const finalText = candidate.parts.map((p) => p.text || "").join("");
      console.log(`Agent: ${finalText}`);
      return finalText;
    }

    const toolResults = [];
    for (const part of toolCallParts) {
      const { name, args } = part.functionCall;
      console.log(`  → Calling tool: ${name}(${JSON.stringify(args)})`);

      const result = await mcpClient.callTool({ name, arguments: args });
      const resultText = result.content.map((c) => c.text || "").join("\n");
      console.log(`  ← Result: ${resultText.slice(0, 120)}...`);

      toolResults.push({
        functionResponse: {
          name,
          response: { output: resultText },
        },
      });
    }

    messages.push({ role: "model", parts: candidate.parts });
    messages.push({ role: "user", parts: toolResults });
  }
}
```

The loop works like a conversation:

1. We send the user prompt + available tools to Gemini
2. Gemini either answers or says "I need to call tool X with arguments Y"
3. We execute the tool call via MCP and add the result back to the conversation
4. Repeat until Gemini gives a final text answer with no more tool calls

**This is exactly what happens inside Claude, ChatGPT, and VS Code Copilot when they use tools — the loop is always there, whether the framework hides it or not.**

### Section 4 - Ask Questions in Natural Language

```javascript
await ask(
  "Create a new OSS bucket called 'devcon-test' with a persistent policy in the US region, then list my US buckets to confirm it was created.",
);

await mcpClient.close();
```

Gemini reads the descriptions of all tools your server exposes and picks the right ones for each request. You don't specify tool names. You don't write orchestration code. The model decides.

[View complete `agent.js` in Source Code →](/code-states#state-8:agent.js)

## Part 5 - Run the Agent

```bash
# Terminal 1
node fs-server.js

# Terminal 2
node aps-server.js

# Terminal 3
node server.js

# Terminal 4 - the agent
node agent.js
```

## Challenges

**A - Add a system prompt** to shape the agent's personality. Before the `while` loop, prepend a system message to `messages`:

```javascript
const messages = [
  {
    role: "user",
    parts: [
      {
        text: "You are a concise assistant for AEC professionals. Always include units and be factual.",
      },
    ],
  },
  { role: "model", parts: [{ text: "Understood." }] },
  { role: "user", parts: [{ text: userPrompt }] },
];
```

**B - Build a simple REPL** so you can type questions interactively:

```javascript
import * as readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const loop = () =>
  rl.question("\nYou: ", async (input) => {
    if (input === "exit") return rl.close();
    await ask(input);
    loop();
  });

loop();
```

Replace the hardcoded `ask()` calls with this loop and you have a working AI assistant backed by your entire MCP system.

[View complete solution `agent.js` in Source Code →](/code-states#state-8:agent.js)

## The Full Picture

```
          You (natural language)
                   ↓
                agent.js
                   ↓  listTools() on startup
                   ↓  generateContent() + tools on each message
            Gemini 2.5 Flash
                   ↓  functionCall: { name, args }
                agent.js
                   ↓  callTool({ name, arguments })
             server.js :3000
                   ↓
    ┌──────────────┼─────────────────┐
    │              │                 │
fs-server.js  aps-server.js    Open-Meteo
   :3001         :3002           (HTTPS)
    │              │
local files   Autodesk Platform Services API
```

Every layer communicates over HTTP. Every tool is discovered dynamically. The LLM never calls a tool directly — it proposes, the agent executes, the result flows back. That is MCP.
