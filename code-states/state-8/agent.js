import { GoogleGenAI } from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import "dotenv/config";

// --- Connect to MCP server ---
const mcpClient = new Client({ name: "devcon-agent", version: "1.0.0" });

await mcpClient.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3000/mcp")),
);

const { tools } = await mcpClient.listTools();
console.log(`Connected. ${tools.length} tools available:`);
tools.forEach((t) => console.log(`  - ${t.name}: ${t.description}`));

// --- Convert MCP tools to Gemini function declarations ---
const geminiTools = [
  {
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })),
  },
];

// --- Initialise Gemini ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Tool-calling loop ---
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
      console.log(`  ← Result: ${resultText.slice(0, 120)}`);

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

await ask("What files are in the project directory?");
await ask("What is the weather like in London?");

await mcpClient.close();
