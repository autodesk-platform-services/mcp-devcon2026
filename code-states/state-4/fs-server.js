import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "node:http";
import { readdir } from "node:fs/promises";

function createServer() {
  const server = new McpServer({
    name: "devcon-filesystem-server",
    version: "1.0.0",
  });

  server.registerTool(
    "list_directory",
    {
      description: "Lists all files and folders in a given directory path",
      inputSchema: {
        path: z.string().describe("Absolute path to the directory"),
      },
    },
    async ({ path: dirPath }) => {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const files = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
      }));
      return { content: [{ type: "text", text: JSON.stringify(files) }] };
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

httpServer.listen(3001, () => {
  console.log("Filesystem MCP server running at http://localhost:3001/mcp");
});
