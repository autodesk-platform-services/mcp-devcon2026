# Production Checklist

_What to Do Before You Ship Your MCP System_

## Introduction

Everything you have built in this workshop works locally. Processes talk to each other over `localhost`, credentials sit in a `.env` file, errors crash the terminal, and anyone on the same machine can call your `/mcp` endpoints without authentication.

None of that is acceptable in production. This document walks through every gap between what you have and what a production deployment requires - with concrete steps and code for each one.

The checklist is ordered by priority. Items at the top are non-negotiable for any deployment. Items toward the end are important but can be phased in.

## 1. HTTPS - Encrypt Everything in Transit

### Why

Right now all MCP communication travels over plain HTTP. Anyone on the same network can read or modify messages between your client, your servers, and the APS API. This includes credentials, tool arguments, and responses.

### What to do

In production you do not add HTTPS directly to your Node.js servers. You put a **reverse proxy** in front of them that handles TLS termination. Your Node servers stay on HTTP internally; the proxy handles the encrypted connection from the outside world.

**Recommended options:**

- **Nginx** - the most common choice for VPS deployments
- **Caddy** - automatically provisions and renews Let's Encrypt certificates with zero configuration
- **Cloud load balancers** - if deploying to AWS, GCP, or Azure, TLS is handled at the load balancer level

**Minimal Caddy configuration** (replace `yourdomain.com`):

```
yourdomain.com {
    reverse_proxy /mcp* localhost:3000
}

fs.yourdomain.com {
    reverse_proxy /mcp* localhost:3001
}

aps.yourdomain.com {
    reverse_proxy /mcp* localhost:3002
}
```

Caddy fetches and renews the Let's Encrypt certificate automatically. No manual cert management required.

**What changes in your code:** update all `new URL("http://localhost:PORT/mcp")` calls in `server.js` and `agent.js` to use your HTTPS domain URLs. Everything else stays the same.

## 2. Authentication - Protect Your MCP Endpoints

### Why

Your `/mcp` endpoints are currently open to anyone. In production, every request to your MCP servers must prove it is authorised. Without this, anyone who discovers your server URLs can call your tools, read your APS data, or consume your Gemini quota.

### What to do - API key authentication (simplest)

Add an auth check inside the HTTP request handler on every server. This is the right approach when your clients are internal services or controlled agents, not end users.

**Add to every server (server.js, fs-server.js, aps-server.js):**

```javascript
const API_KEY = process.env.MCP_API_KEY;
if (!API_KEY) throw new Error("Missing MCP_API_KEY environment variable.");

const httpServer = http.createServer(async (req, res) => {
  // Validate API key on every request
  const key = req.headers["x-api-key"];
  if (key !== API_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  // ... rest of your request handling
});
```

**Add to every client connection (server.js connecting to fs-server, aps-server):**

```javascript
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const fsClient = new Client({ name: "devcon-fs-bridge", version: "1.0.0" });
await fsClient.connect(
  new StreamableHTTPClientTransport(new URL("https://fs.yourdomain.com/mcp"), {
    requestInit: {
      headers: { "x-api-key": process.env.MCP_API_KEY },
    },
  }),
);
```

**Add to your .env:**

```bash
MCP_API_KEY="generate-a-long-random-string-here"
```

Generate a strong key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### For user-facing agents - OAuth 2.0

If end users interact directly with your agent (rather than it being an internal backend service), each user needs their own identity. This is a larger scope - use a library like `jose` for JWT validation, or integrate with an identity provider (Auth0, Okta, Azure AD).

## 3. Input Validation - Never Trust What Comes In

### Why

Your Zod schemas currently validate types (string, number, enum), but they do not constrain values. A tool that accepts a file path as a string could be called with `"../../etc/passwd"`. A tool that accepts a project ID could be called with a 10,000-character string designed to break your upstream API call.

### What to do

Tighten every schema. Add length limits, pattern matching, and range constraints:

```javascript
// Before - trusts the input completely
{
  path: z.string();
}

// After - constrained and safe
{
  path: z.string()
    .min(1)
    .max(500)
    .regex(/^[a-zA-Z0-9_\-./]+$/, "Invalid path characters")
    .refine((p) => !p.includes(".."), "Path traversal not allowed");
}
```

```javascript
// Before
{
  project_id: z.string();
}

// After
{
  project_id: z.string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/, "Invalid project ID format");
}
```

```javascript
// Before
{
  limit: z.number();
}

// After
{
  limit: z.number().int().min(1).max(100).default(20);
}
```

**Key rules:**

- Every string input gets a `max()` length
- File paths are validated against a whitelist of allowed characters and blocked from containing `..`
- Numeric inputs get `min()` and `max()` bounds
- Enum inputs stay as enums - never accept free-form strings where a fixed set is expected
- APS IDs are validated against their known format before being interpolated into API URLs

## 4. Error Handling - Fail Gracefully, Log Everything

### Why

Right now, an unhandled error in a tool handler crashes the request with an unformatted stack trace - or worse, exposes internal details to the caller. In production, errors must be caught, logged internally, and returned to the client as clean, safe messages.

### What to do

Wrap every tool handler in a try/catch and standardise the error response:

```javascript
server.registerTool(
  "list_acc_projects",
  { description: "Lists all ACC projects" },
  async () => {
    try {
      const token = await getToken();
      // ... API calls ...
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      // Log internally with full detail
      console.error("[list_acc_projects] Error:", error.message, error.stack);

      // Return a safe, generic message to the caller
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve projects. Please try again or contact support.",
          },
        ],
      };
    }
  },
);
```

**Wrap your `http.createServer` handler in a try/catch** to catch anything that slips through:

```javascript
const httpServer = http.createServer(async (req, res) => {
  try {
    // ... your request handling
  } catch (err) {
    console.error("Unhandled server error:", err.message, err.stack);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
});
```

**Rules:**

- Never return stack traces, internal file paths, environment variable names, or API error bodies to the client
- Always log the full error internally (see Logging section)
- Distinguish between client errors (bad input → 400) and server errors (API failure → 500) in your HTTP responses
- Add timeouts to every external API call to prevent hanging requests:

```javascript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000); // 10 second timeout
try {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
} finally {
  clearTimeout(timeout);
}
```

## 5. Logging - Know What Is Happening

### Why

`console.log` works locally. In production you need structured logs - with timestamps, severity levels, and request context - that can be searched, filtered, and aggregated across multiple processes and servers.

### What to do

Install [pino](https://www.npmjs.com/package/pino) - a fast, structured logger:

```bash
npm install pino pino-pretty
```

**Replace console calls with pino:**

```javascript
import pino from "pino";

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined // JSON output in production
      : { target: "pino-pretty" }, // Human-readable in development
});

// In tool handlers and middleware:
log.info(
  { tool: "list_buckets", userId: req.headers["x-user-id"] },
  "Tool called",
);
log.error({ tool: "list_buckets", error: error.message }, "Tool failed");
log.warn({ path }, "Suspicious path rejected");
```

**What structured logs enable:**

- Filter all errors from a specific tool: `jq 'select(.tool=="list_buckets" and .level==50)'`
- Count tool calls per hour in your log aggregator
- Set alerts on error rates
- Trace a single agent session across multiple server processes using a shared request ID

**Add a request ID to every incoming request** so you can trace the full chain across servers:

```javascript
import { randomUUID } from "node:crypto";

const httpServer = http.createServer(async (req, res) => {
  const requestId = req.headers["x-request-id"] ?? randomUUID();
  res.setHeader("x-request-id", requestId);
  // pass requestId into your log calls:
  log.info({ requestId, tool: "..." }, "Tool called");
  // ...
});
```

In production, pipe your logs to a log aggregator: **Datadog**, **Grafana Loki**, **AWS CloudWatch**, or simply rotating files with `pino/file`.

## 6. Process Management - Stay Running

### Why

Your servers currently run as bare `node` processes. If one crashes, it stays down until someone manually restarts it. If the server reboots, nothing comes back up. In production your services must restart automatically on failure and start automatically on system boot.

### What to do - PM2

[PM2](https://pm2.keymetrics.io) is the standard Node.js process manager.

```bash
npm install -g pm2
```

**Create `ecosystem.config.cjs` in your project root:**

```javascript
module.exports = {
  apps: [
    {
      name: "aps-server",
      script: "aps-server.js",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        PORT: 3002,
      },
    },
    {
      name: "fs-server",
      script: "fs-server.js",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },
    {
      name: "main-server",
      script: "server.js",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000, // Give upstream servers time to start first
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
```

**Start, monitor, and manage:**

```bash
pm2 start ecosystem.config.cjs   # Start all three servers
pm2 status                        # View running processes
pm2 logs                          # Tail all logs
pm2 logs main-server              # Tail one server
pm2 restart main-server           # Restart one server
pm2 save                          # Persist config across reboots
pm2 startup                       # Generate boot script (follow its instructions)
```

**PM2 gives you:**

- Automatic restart on crash with exponential backoff
- Process stays running after SSH session ends
- Auto-start on system boot
- Cluster mode (`instances: "max"`) for multi-core scaling when needed
- Built-in log rotation

## 7. Health Check Endpoint - Know Your Servers Are Up

### Why

Your reverse proxy, load balancer, container orchestrator (Kubernetes, ECS), and monitoring system all need a way to ask "is this server alive and ready to serve requests?" without calling an actual MCP tool. A health check endpoint is the standard answer.

### What to do

Add a `/health` route to every server **before** the API key check, so monitoring tools don't need credentials:

```javascript
const httpServer = http.createServer(async (req, res) => {
  // Health check — no auth required
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "devcon-aps-server",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
      }),
    );
    return;
  }

  // API key check
  const key = req.headers["x-api-key"];
  if (key !== API_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // MCP endpoint
  if (req.url !== "/mcp") {
    res.writeHead(404).end("Not found");
    return;
  }
  // ... transport + server handling
});
```

**For `aps-server.js`, include a token check in the health handler:**

```javascript
if (req.url === "/health") {
  try {
    await getToken(); // Confirm APS credentials are valid
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", aps: "authenticated" }));
  } catch (error) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "error",
        aps: "auth_failed",
        message: error.message,
      }),
    );
  }
  return;
}
```

**PM2 health check integration:**

```javascript
// In ecosystem.config.cjs
{
  name: "main-server",
  script: "server.js",
  wait_ready: true,           // Wait for server to signal it's ready
  health_check_http: {
    url: "http://localhost:3000/health",
    interval: 30000           // Check every 30 seconds
  }
}
```

**Test it:**

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
```

## 8. Session Support - Stateful Multi-Turn Agents

### Why

All your MCP servers currently run in stateless mode (`sessionIdGenerator: undefined`). Every request is independent - the server remembers nothing between calls. For simple tool execution this is fine. But if your agent needs to maintain context across a long conversation, or if you want to support reconnecting clients without losing state, you need session management.

### What to do - enable sessions on your MCP servers

```javascript
import { randomUUID } from "node:crypto";

// Change from:
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

// Change to:
const transports = {}; // session ID → transport instance

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];

  if (sessionId && transports[sessionId]) {
    // Reconnect to existing session
    await transports[sessionId].handleRequest(req, res, req.body);
  } else {
    // Create new session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    // Store the session after the first request (when the ID is assigned)
    if (transport.sessionId) {
      transports[transport.sessionId] = transport;
    }
  }
});

// Clean up closed sessions
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && transports[sessionId]) {
    await transports[sessionId].close();
    delete transports[sessionId];
  }
  res.status(200).end();
});
```

> **Note:** this in-memory session store is lost if the process restarts. For production persistence, store sessions in **Redis** and rehydrate them on reconnect.

## 9. Rate Limiting - Protect Against Abuse

### Why

Without rate limiting, a single misconfigured agent, a runaway loop in your code, or a bad actor can exhaust your Gemini free tier, trigger Autodesk API throttling, or take down your server with concurrent requests.

### What to do

```javascript
// Simple in-memory rate limiter: 60 requests per IP per minute
const requestCounts = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 60;
  const entry = requestCounts.get(ip) ?? { count: 0, start: now };
  if (now - entry.start > windowMs) {
    entry.count = 1;
    entry.start = now;
  } else {
    entry.count++;
  }
  requestCounts.set(ip, entry);
  return entry.count > max;
}

// Apply at the top of your http.createServer handler:
const httpServer = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (isRateLimited(ip)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too many requests, please slow down." }));
    return;
  }
  // ... rest of handler
});
```

Adjust `max` based on your expected load and upstream API limits. For APS specifically, check the [APS rate limit documentation](https://aps.autodesk.com/en/docs/overview/v2/developers_guide/rate-limits/) - different APIs have different thresholds.

## 10. Secrets Management - Never Hardcode Credentials

### Why

`.env` files are fine for local development. They should never be committed to git, deployed in plain text to servers, or visible in CI/CD logs. In production, secrets are managed externally and injected at runtime.

### What to do

**Minimum viable:** environment variables set by your hosting platform. Every major platform (Railway, Render, Fly.io, Heroku, AWS, GCP, Azure) has a UI for this. Your code stays exactly the same - `process.env.APS_CLIENT_ID` works regardless of how the value got there.

**For teams:** use a secrets manager:

- **AWS Secrets Manager** or **Parameter Store** - fetch at startup with the AWS SDK
- **HashiCorp Vault** - self-hosted, cloud-agnostic
- **Doppler** or **Infisical** - developer-friendly, inject secrets as environment variables without code changes

**Rules that apply everywhere:**

- `.env` is in `.gitignore` - verify this before your first commit
- Rotate secrets on a schedule - APS client secrets and API keys should be rotated at least annually
- Use different credentials per environment - development, staging, and production each get their own APS app and API keys
- Audit which services have access to which secrets - the principle of least privilege

## Summary

| #   | Item                            | Impact                              | Effort                              |
| --- | ------------------------------- | ----------------------------------- | ----------------------------------- |
| 1   | HTTPS via reverse proxy         | Critical - encrypts all traffic     | Low - Caddy is near-zero config     |
| 2   | API key authentication          | Critical - locks down endpoints     | Low - one middleware per server     |
| 3   | Input validation (tighter Zod)  | High - prevents injection & abuse   | Low - extend existing schemas       |
| 4   | Error handling & safe responses | High - no data leaks on failure     | Medium - wrap every tool handler    |
| 5   | Structured logging (pino)       | High - essential for debugging      | Low - replace console calls         |
| 6   | PM2 process manager             | High - keeps servers alive          | Low - one config file               |
| 7   | Health check endpoints          | Medium - enables monitoring         | Low - one route per server          |
| 8   | Session support                 | Medium - needed for stateful agents | Medium - rewrite transport setup    |
| 9   | Rate limiting                   | Medium - protects API quotas        | Low - one middleware per server     |
| 10  | Secrets management              | High - no credentials in code       | Low to Medium - depends on platform |
