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
const VERSION = "1.0.0";
const CLIENT_TAG = process.env.PHALANGE_CLIENT_TAG?.trim() || `phalange-umbrella/${VERSION}`;

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
  {
    name: "nursing_facility_lookup",
    description:
      "Find a nursing home by name (optionally narrowed by state or city) in the Phalange nursing-home extract: identity, status, CMS's own star ratings with their as-of date, latest survey date, latest-survey deficiency count, and stored penalty totals when the extract carries penalty fields (the current extract does not include them, and answers say so rather than reporting zero). Every answer carries a data_snapshot block dating it to its extract. A facility absent from the extract is reported as not found — never as clean or compliant.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Facility name (or part of it) as licensed." },
        state: { type: "string", description: "Optional 2-letter state code." },
        city: { type: "string", description: "Optional city name." },
      },
      required: ["name"],
    },
  },
  {
    name: "nursing_search",
    description:
      "Browse nursing homes in the extract by state, city, or ZIP, with a result cap. Returns summary records plus the data_snapshot block dating the extract.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", description: "2-letter state code." },
        city: { type: "string" },
        zip: { type: "string" },
        limit: { type: "number", description: "Max records (default 20, cap 50)." },
      },
    },
  },
  {
    name: "nursing_state_summary",
    description:
      "Per-state aggregates computed from the nursing-home extract itself: facility count and status split, CMS star distribution (including how many facilities CMS publishes no overall rating for), and stored penalty totals when the extract carries penalty fields (not in the current extract — reported as not included, never as zero). Labelled as extract-derived and dated by the data_snapshot block.",
    inputSchema: {
      type: "object",
      properties: { state: { type: "string", description: "2-letter state code." } },
      required: ["state"],
    },
  },
  {
    name: "schools_school_lookup",
    description:
      "Find a public school by name (optionally narrowed by state or city) in the Phalange schools extract (MA + TX): identity, district, level, enrollment, tests taken, and the state's own published proficiency percentages for ELA and math with their data year — each state's measure is its own and is labelled as such. Every answer carries a data_snapshot block. No composite score or ranking is computed, ever.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "School name (or part of it)." },
        state: { type: "string", description: "Optional: MA or TX." },
        city: { type: "string", description: "Optional city name." },
      },
      required: ["name"],
    },
  },
  {
    name: "schools_search",
    description:
      "Browse schools in the extract by state, district, city, or level, with a result cap. Returns summary records plus the data_snapshot block.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", description: "MA or TX." },
        district: { type: "string" },
        city: { type: "string" },
        level: { type: "string", description: "Elementary / Middle / High (as stored)." },
        limit: { type: "number", description: "Max records (default 20, cap 50)." },
      },
    },
  },
  {
    name: "schools_compare",
    description:
      "Compare 2 to 4 named schools side by side on their published figures only (enrollment, tests taken, ELA/math proficiency with each state's own measure labelled). No composite score, no ranking, no winner is produced.",
    inputSchema: {
      type: "object",
      properties: {
        schools: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              state: { type: "string", description: "Optional: MA or TX." },
              city: { type: "string" },
            },
            required: ["name"],
          },
        },
      },
      required: ["schools"],
    },
  },
];

async function callApi(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json", "X-Phalange-Client": CLIENT_TAG },
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


/* ---------- static-vertical extracts (nursing / schools) ----------
 * Each line publishes a versioned JSONL extract + manifest at a
 * stable URL on its own domain (spec: UMBRELLA-MCP-DESIGN-2026-11-27).
 * Loaded lazily on first use per session, verified (schemaVersion +
 * sha256 + entity count), cached in memory. Every answer carries the
 * manifest's snapshot block; an answer that cannot be dated is not
 * served. A vertical that fails to load degrades alone. */
import { createHash } from "node:crypto";

const EXTRACT_SOURCES = {
  nursing: {
    url: process.env.PHALANGE_NURSING_EXTRACT_URL ?? "https://nursing.phalangeai.com/mcp-data/nursing-extract.jsonl",
  },
  schools: {
    url: process.env.PHALANGE_SCHOOLS_EXTRACT_URL ?? "https://schools.phalangeai.com/schools-extract.jsonl",
  },
};
const extractCache = new Map();

async function loadExtract(vertical) {
  if (extractCache.has(vertical)) return extractCache.get(vertical);
  const promise = (async () => {
    const { url } = EXTRACT_SOURCES[vertical];
    const manifestUrl = url.replace(/\.jsonl$/, "") + ".manifest.json";
    const mRes = await fetch(manifestUrl);
    if (!mRes.ok) throw new Error(`${vertical} extract manifest unavailable (HTTP ${mRes.status})`);
    const manifest = await mRes.json();
    if (manifest.schemaVersion !== 1)
      throw new Error(`${vertical} extract schemaVersion ${manifest.schemaVersion} is not understood by this server (expected 1)`);
    const rRes = await fetch(url);
    if (!rRes.ok) throw new Error(`${vertical} extract unavailable (HTTP ${rRes.status})`);
    const text = await rRes.text();
    const sha = createHash("sha256").update(text, "utf8").digest("hex");
    if (sha !== manifest.sha256) throw new Error(`${vertical} extract failed its sha256 check against the manifest`);
    const records = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    if (manifest.entityCount !== records.length)
      throw new Error(`${vertical} extract entity count mismatch (manifest ${manifest.entityCount}, file ${records.length})`);
    const snapshot = {
      vertical,
      extract_version: manifest.extractVersion,
      generated_at: manifest.generatedAt,
      source_vintage: manifest.sourceVintage,
    };
    return { records, snapshot };
  })();
  extractCache.set(vertical, promise);
  try {
    return await promise;
  } catch (e) {
    extractCache.delete(vertical);
    throw new Error(`The ${vertical} data extract could not be loaded, so no ${vertical} answer can be dated or served. (${e.message})`);
  }
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function nameScore(recordName, query) {
  const rn = norm(recordName), q = norm(query);
  if (!q) return 0;
  if (rn === q) return 3;
  if (rn.startsWith(q) || rn.includes(q)) return 2;
  const qTokens = new Set(q.split(" "));
  const rTokens = new Set(rn.split(" "));
  let hit = 0;
  for (const t of qTokens) if (rTokens.has(t)) hit++;
  return hit >= Math.max(1, qTokens.size - 1) ? 1 : 0;
}
function bestMatches(records, query, extra) {
  return records
    .map((r) => ({ r, s: nameScore(r.name, query) }))
    .filter((x) => x.s > 0 && extra(x.r))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.r);
}
const capLimit = (v) => Math.min(50, Math.max(1, Number(v ?? 20) || 20));

const EXTRACT_CALLS = {
  nursing_facility_lookup: async (a) => {
    const { records, snapshot } = await loadExtract("nursing");
    const st = a.state ? String(a.state).toUpperCase() : null;
    const matches = bestMatches(records, a.name, (r) =>
      (!st || r.state === st) && (!a.city || norm(r.city) === norm(a.city)));
    return { data_snapshot: snapshot, matches, note: matches.length ? undefined : "No facility in the extract matches that name. Absence from the extract is not a statement about the facility." };
  },
  nursing_search: async (a) => {
    const { records, snapshot } = await loadExtract("nursing");
    const st = a.state ? String(a.state).toUpperCase() : null;
    const out = records.filter((r) =>
      (!st || r.state === st) &&
      (!a.city || norm(r.city) === norm(a.city)) &&
      (!a.zip || String(r.zip) === String(a.zip)));
    return { data_snapshot: snapshot, total: out.length, records: out.slice(0, capLimit(a.limit)) };
  },
  nursing_state_summary: async (a) => {
    const { records, snapshot } = await loadExtract("nursing");
    const st = String(a.state).toUpperCase();
    const rows = records.filter((r) => r.state === st);
    const stars = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, not_rated: 0 };
    let penaltyCount = 0, penaltyTotal = 0, closed = 0, penaltiesPresent = false;
    for (const r of rows) {
      const o = r.cmsStars?.overall;
      if (o == null) stars.not_rated++; else stars[String(o)] = (stars[String(o)] ?? 0) + 1;
      if (r.status === "closed") closed++;
      if (r.penalties) { penaltiesPresent = true; penaltyCount += r.penalties.count ?? 0; penaltyTotal += r.penalties.totalAmount ?? 0; }
    }
    // Penalty fields may be struck from an extract (e.g. pending a
    // data audit): absence must read as "not included", never as
    // zero penalties.
    return { data_snapshot: snapshot, derived_from: "the extract itself", state: st, facilities: rows.length, closed, cms_overall_stars: stars, penalties_stored: penaltiesPresent ? { count: penaltyCount, total_amount: penaltyTotal } : null, note: penaltiesPresent ? undefined : "Penalty fields are not included in this extract, so no penalty totals are reported." };
  },
  schools_school_lookup: async (a) => {
    const { records, snapshot } = await loadExtract("schools");
    const st = a.state ? String(a.state).toUpperCase() : null;
    const matches = bestMatches(records, a.name, (r) =>
      (!st || r.state === st) && (!a.city || norm(r.city) === norm(a.city)));
    return { data_snapshot: snapshot, matches, note: matches.length ? undefined : "No school in the extract matches that name." };
  },
  schools_search: async (a) => {
    const { records, snapshot } = await loadExtract("schools");
    const st = a.state ? String(a.state).toUpperCase() : null;
    const out = records.filter((r) =>
      (!st || r.state === st) &&
      (!a.district || norm(r.district) === norm(a.district)) &&
      (!a.city || norm(r.city) === norm(a.city)) &&
      (!a.level || norm(r.level) === norm(a.level)));
    return { data_snapshot: snapshot, total: out.length, records: out.slice(0, capLimit(a.limit)) };
  },
  schools_compare: async (a) => {
    const list = a.schools ?? [];
    if (list.length < 2 || list.length > 4) throw new Error("schools_compare takes 2 to 4 schools.");
    const { records, snapshot } = await loadExtract("schools");
    const resolved = [], unresolved = [];
    for (const q of list) {
      const st = q.state ? String(q.state).toUpperCase() : null;
      const m = bestMatches(records, q.name, (r) => (!st || r.state === st) && (!q.city || norm(r.city) === norm(q.city)));
      if (m.length) resolved.push(m[0]); else unresolved.push(q.name);
    }
    return { data_snapshot: snapshot, schools: resolved, unresolved, note: "Published figures side by side. No composite score, ranking, or winner is computed." };
  },
};

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
  ...EXTRACT_CALLS,
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
        serverInfo: { name: "phalange", version: VERSION },
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
