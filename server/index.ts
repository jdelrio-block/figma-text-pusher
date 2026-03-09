import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";

const WS_PORT = 1994;
const HTTP_PORT = 3001;
const RESPONSE_TIMEOUT_MS = 30_000;

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
  settled: boolean; // prevent double-settle
}

// Keep process alive no matter what
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err.message));
process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
process.on("SIGPIPE", () => console.warn("[SIGPIPE] ignored"));

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
      if (req && !req.settled) {
        req.settled = true;
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
    for (const [id, req] of [...pending.entries()]) {
      if (!req.settled) {
        req.settled = true;
        clearTimeout(req.timer);
        pending.delete(id);
        req.reject(new Error("Plugin disconnected"));
      }
    }
  });

  ws.on("error", (err) => {
    console.error("[ws error]", err.message);
  });
});

wss.on("error", (err) => {
  console.error("[wss error]", err.message);
});

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
    const entry: PendingRequest = {
      resolve,
      reject,
      settled: false,
      timer: setTimeout(() => {
        if (!entry.settled) {
          entry.settled = true;
          pending.delete(id);
          reject(new Error("TIMEOUT"));
        }
      }, RESPONSE_TIMEOUT_MS),
    };

    pending.set(id, entry);

    try {
      pluginSocket.send(JSON.stringify(msg));
    } catch (err) {
      if (!entry.settled) {
        entry.settled = true;
        clearTimeout(entry.timer);
        pending.delete(id);
        reject(new Error("Send failed"));
      }
    }
  });
}

// Safe response helper — never throws, never double-writes
function send(res: http.ServerResponse, status: number, body: unknown) {
  try {
    if (!res.headersSent) {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    }
  } catch (err) {
    console.error("[send error]", (err as Error).message);
  }
}

function handlePluginRoute(
  res: http.ServerResponse,
  type: ServerToPluginMessage["type"],
  data?: ServerToPluginMessage["data"]
) {
  sendToPlugin(type, data)
    .then((result) => send(res, 200, result))
    .catch((err: Error) => {
      if (err.message === "NO_PLUGIN") send(res, 503, { error: "no_plugin_connected" });
      else if (err.message === "TIMEOUT") send(res, 504, { error: "plugin_timeout" });
      else send(res, 400, { error: err.message });
    });
}

// --- HTTP server ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${HTTP_PORT}`);

  // GET /health
  if (req.method === "GET" && url.pathname === "/health") {
    const connected = pluginSocket?.readyState === WebSocket.OPEN;
    if (!connected) {
      send(res, 200, { server: "running", plugin: "disconnected" });
      return;
    }
    sendToPlugin("health_check")
      .then((data) => send(res, 200, { server: "running", plugin: "connected", ...(data as object) }))
      .catch(() => send(res, 200, { server: "running", plugin: "connected" }));
    return;
  }

  // POST routes
  if (req.method === "POST") {
    readBody(req)
      .then((body) => {
        const payload = body ? JSON.parse(body) : {};
        if (url.pathname === "/push")   handlePluginRoute(res, "update_text", payload);
        else if (url.pathname === "/list")   handlePluginRoute(res, "list_nodes", payload);
        else if (url.pathname === "/rename") handlePluginRoute(res, "rename_nodes", payload);
        else send(res, 404, { error: "not_found" });
      })
      .catch((err: Error) => send(res, 400, { error: err.message }));
    return;
  }

  send(res, 404, { error: "not_found" });
});

server.on("error", (err) => console.error("[http error]", err.message));

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
  console.log(`  GET  /health — server + plugin status`);
  console.log(`  POST /push   — push text updates`);
  console.log(`  POST /list   — list text nodes`);
  console.log(`  POST /rename — rename layers`);
});
