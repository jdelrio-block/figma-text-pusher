import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";

const WS_PORT = 1994;
const HTTP_PORT = 3001;
const RESPONSE_TIMEOUT_MS = 10_000;

// Message protocol types
interface ServerToPluginMessage {
  type: "update_text" | "list_nodes" | "health_check" | "rename_nodes";
  id: string;
  data?: Record<string, string> | { frame?: string };
}

interface PluginToServerMessage {
  type: "response";
  id: string;
  data: unknown;
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// State
let pluginSocket: WebSocket | null = null;
const pending = new Map<string, PendingRequest>();

// --- WebSocket server (plugin connects here) ---
const wss = new WebSocketServer({ port: WS_PORT, path: "/ws" });

wss.on("listening", () => {
  console.log(`WebSocket server listening on :${WS_PORT}/ws`);
});

wss.on("connection", (ws) => {
  pluginSocket = ws;
  console.log("Figma plugin connected");

  ws.on("message", (raw) => {
    try {
      const msg: PluginToServerMessage = JSON.parse(raw.toString());
      const req = pending.get(msg.id);
      if (req) {
        clearTimeout(req.timer);
        pending.delete(msg.id);
        req.resolve(msg.data);
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    if (pluginSocket === ws) {
      pluginSocket = null;
      console.log("Figma plugin disconnected");
    }
    // reject all pending requests
    for (const [id, req] of pending) {
      clearTimeout(req.timer);
      pending.delete(id);
      req.reject(new Error("Plugin disconnected"));
    }
  });
});

// Send a message to the plugin and wait for a response
function sendToPlugin(
  type: ServerToPluginMessage["type"],
  data?: ServerToPluginMessage["data"]
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!pluginSocket || pluginSocket.readyState !== WebSocket.OPEN) {
      reject(new Error("NO_PLUGIN"));
      return;
    }

    const id = uuidv4();
    const msg: ServerToPluginMessage = { type, id, data };

    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("TIMEOUT"));
    }, RESPONSE_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    pluginSocket.send(JSON.stringify(msg));
  });
}

// --- HTTP server ---
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  const url = new URL(req.url ?? "/", `http://localhost:${HTTP_PORT}`);

  // GET /health
  if (req.method === "GET" && url.pathname === "/health") {
    const connected =
      pluginSocket !== null && pluginSocket.readyState === WebSocket.OPEN;

    if (!connected) {
      res.writeHead(200);
      res.end(
        JSON.stringify({ server: "running", plugin: "disconnected", port: HTTP_PORT })
      );
      return;
    }

    sendToPlugin("health_check")
      .then((data) => {
        res.writeHead(200);
        res.end(JSON.stringify({ server: "running", plugin: "connected", ...((data as object) ?? {}) }));
      })
      .catch(() => {
        res.writeHead(503);
        res.end(JSON.stringify({ error: "plugin_not_responding" }));
      });
    return;
  }

  // POST /push
  if (req.method === "POST" && url.pathname === "/push") {
    readBody(req)
      .then((body) => {
        const payload = JSON.parse(body) as Record<string, string>;
        return sendToPlugin("update_text", payload);
      })
      .then((data) => {
        res.writeHead(200);
        res.end(JSON.stringify(data));
      })
      .catch((err: Error) => {
        if (err.message === "NO_PLUGIN") {
          res.writeHead(503);
          res.end(JSON.stringify({ error: "no_plugin_connected" }));
        } else if (err.message === "TIMEOUT") {
          res.writeHead(504);
          res.end(JSON.stringify({ error: "plugin_timeout" }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    return;
  }

  // POST /list
  if (req.method === "POST" && url.pathname === "/list") {
    readBody(req)
      .then((body) => {
        const payload = body ? (JSON.parse(body) as { frame?: string }) : {};
        return sendToPlugin("list_nodes", payload);
      })
      .then((data) => {
        res.writeHead(200);
        res.end(JSON.stringify(data));
      })
      .catch((err: Error) => {
        if (err.message === "NO_PLUGIN") {
          res.writeHead(503);
          res.end(JSON.stringify({ error: "no_plugin_connected" }));
        } else if (err.message === "TIMEOUT") {
          res.writeHead(504);
          res.end(JSON.stringify({ error: "plugin_timeout" }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    return;
  }

  // POST /rename
  if (req.method === "POST" && url.pathname === "/rename") {
    readBody(req)
      .then((body) => {
        const payload = JSON.parse(body) as Record<string, string>;
        return sendToPlugin("rename_nodes", payload);
      })
      .then((data) => {
        res.writeHead(200);
        res.end(JSON.stringify(data));
      })
      .catch((err: Error) => {
        if (err.message === "NO_PLUGIN") {
          res.writeHead(503);
          res.end(JSON.stringify({ error: "no_plugin_connected" }));
        } else if (err.message === "TIMEOUT") {
          res.writeHead(504);
          res.end(JSON.stringify({ error: "plugin_timeout" }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "not_found" }));
});

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

server.listen(HTTP_PORT, () => {
  console.log(`Bridge server running on :${HTTP_PORT}`);
  console.log(`  POST /push   — push text updates to Figma`);
  console.log(`  GET  /health — check server + plugin status`);
  console.log(`  POST /list   — list text nodes`);
});
