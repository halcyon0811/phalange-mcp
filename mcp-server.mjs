#!/usr/bin/env node
/**
 * Phalange Restaurant Inspection — MCP server (zero dependencies).
 *
 * Wraps the public agent API at https://eat.phalangeai.com/api/v1 as
 * four MCP tools, so an agent can do restaurant due diligence inside
 * its own workflow instead of scraping inspection PDFs:
 *
 *   restaurant_compliance_lookup  name+address -> compliance answer
 *   restaurant_search             find venues in a covered city
 *   restaurant_venue_detail       one venue's timeline + violations
 *   restaurant_risk_summary       a city's 30-day failure picture
 *
 * Two transports, one file:
 *   stdio (default)   node mcp-server.mjs
 *   Streamable HTTP   node mcp-server.mjs --http --port 8787
 *                     (stateless; POST /mcp; host it anywhere)
 *
 * API key: env PHALANGE_API_KEY. Defaults to the published demo key,
 * which is rate-limited (60/min and 300/day per IP) and fine for
 * evaluation. Calls are metered, never charged today.
 *
 * Data honesty (mirrors the API contract): violation text exists
 * only for each venue's most recent inspection; Austin and
 * Miami-Dade publish none; LA County and Santa Clara County feeds
 * are paused (their sources stalled). coverage_status distinguishes
 * "covered" / "stale" / "not_covered" — a not_covered answer means
 * WE have no data on the business, never that it is clean.
 */
import { createServer } from "node:http";
import { createInterface } from "node:readline";

const BASE = process.env.PHALANGE_API_BASE ?? "https://eat.phalangeai.com";
const API_KEY = process.env.PHALANGE_API_KEY ?? "demo-phalange";
const PROTOCOL = "2024-11-05";

const TOOLS = [
  {
    name: "restaurant_compliance_lookup",
    description:
      "Answer a compliance question about one food business: given its name and street address, return the entity match confidence, coverage_status (covered / stale / not_covered — not_covered means no data, NOT a clean record), latest inspection date and result, violation and critical-violation counts, closure status, and the official source URL. Start every due-diligence check here.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Business name as signed / licensed." },
        address: { type: "string", description: "Street address (city/state/zip help matching)." },
        city: {
          type: "string",
          description:
            "Optional city id to scope the search: boston, nyc, chicago, austin, la-county, santa-clara-county, las-vegas, miami-dade, cambridge. Omit to search all covered cities.",
        },
      },
      required: ["name", "address"],
    },
  },
  {
    name: "restaurant_search",
    description:
      "Search food venues by name within one covered city; returns each venue's key, address, license number, latest inspection summary and stored inspection count. Use a returned key with restaurant_venue_detail.",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City id (see restaurant_compliance_lookup for the list)." },
        q: { type: "string", description: "Name search text." },
        limit: { type: "number", description: "Max results, default 10, max 25." },
      },
      required: ["city", "q"],
    },
  },
  {
    name: "restaurant_venue_detail",
    description:
      "One venue's full stored inspection timeline (dates, results, scores/grades, violation counts) plus the violation lines of its latest inspection (at most 8 lines; violation text is stored only for the latest inspection).",
    inputSchema: {
      type: "object",
      properties: {
        cityId: { type: "string" },
        venueKey: { type: "string", description: "The venue key returned by restaurant_search." },
      },
      required: ["cityId", "venueKey"],
    },
  },
  {
    name: "restaurant_risk_summary",
    description:
      "A covered city's last-30-days picture: stored venues and inspections, window inspections and failures under the city's own result scale, failure rate, and the most-inspected venues. For portfolio or area-level questions, not a verdict on any single venue.",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string", description: "City id." } },
      required: ["city"],
    },
  },
];

async function callApi(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const code = body?.error?.code ?? `http_${res.status}`;
    const message = body?.error?.message ?? text.slice(0, 300);
    throw new Error(`API ${res.status} ${code}: ${message}`);
  }
  return body;
}

const enc = encodeURIComponent;
const TOOL_CALLS = {
  restaurant_compliance_lookup: (a) =>
    callApi(
      `/api/v1/compliance/lookup?name=${enc(a.name)}&address=${enc(a.address)}` +
        (a.city ? `&city=${enc(a.city)}` : ""),
    ),
  restaurant_search: (a) =>
    callApi(
      `/api/v1/venues/search?city=${enc(a.city)}&q=${enc(a.q)}` +
        (a.limit ? `&limit=${enc(String(a.limit))}` : ""),
    ),
  restaurant_venue_detail: (a) =>
    callApi(`/api/v1/venues/${enc(a.cityId)}/${enc(a.venueKey)}`),
  restaurant_risk_summary: (a) => callApi(`/api/v1/risk-summary?city=${enc(a.city)}`),
};

async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== "2.0") return null;
  const isNotification = msg.id === undefined || msg.id === null;
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const replyError = (code, message) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "phalange-restaurant-inspection", version: "1.0.0" },
      });
    case "ping":
      return isNotification ? null : reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = msg.params?.name;
      const fn = TOOL_CALLS[name];
      if (!fn) return replyError(-32602, `Unknown tool: ${name}`);
      try {
        const data = await fn(msg.params?.arguments ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
      } catch (error) {
        return reply({
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        });
      }
    }
    default:
      return isNotification ? null : replyError(-32601, `Method not found: ${msg.method}`);
  }
}

/* ---------------- stdio transport ---------------- */
function serveStdio() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    const out = await handleMessage(msg);
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  });
}

/* ---------------- Streamable HTTP transport (stateless) ---------------- */
function serveHttp(port) {
  const server = createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found", hint: "POST JSON-RPC to /mcp" }));
      return;
    }
    if (req.method === "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed", hint: "This MCP server is stateless; POST JSON-RPC messages." }));
      return;
    }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
        return;
      }
      const out = await handleMessage(msg);
      if (!out) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  server.listen(port, () => {
    console.error(`phalange-restaurant-inspection MCP (http) listening on :${port}/mcp`);
  });
}

const args = process.argv.slice(2);
if (args.includes("--http")) {
  const portIdx = args.indexOf("--port");
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 8787;
  serveHttp(port);
} else {
  serveStdio();
}
