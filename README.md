# Phalange

One MCP server for Phalange's three public-record datasets:
**restaurant inspections**, **nursing-home records**, and **public-school
data** — official records, republished with their sources and dates
attached. The umbrella server lives in [`umbrella/`](umbrella/)
(`phalange-mcp.mjs`, zero dependencies, Node.js 18+); the
restaurant-only server remains available at this root as a component
(see below).

## Tools (10)

| Group | Tool | What it does |
| --- | --- | --- |
| Restaurant | `restaurant_compliance_lookup` | Business name + address → match confidence, coverage status, latest inspection result, violation count, closure status, source URL |
| Restaurant | `restaurant_search` | Search venues in one of 9 US metros by name |
| Restaurant | `restaurant_venue_detail` | One venue's inspection history and latest violation lines |
| Restaurant | `restaurant_risk_summary` | Per-metro aggregates: venues, inspections and failures in a time window |
| Nursing | `nursing_facility_lookup` | One facility's CMS record: star ratings as published, survey history, complaint share of surveys |
| Nursing | `nursing_search` | Search facilities by name, city, or state |
| Nursing | `nursing_state_summary` | Facility counts and survey statistics for one state |
| Schools | `schools_school_lookup` | One school's published proficiency figures (ELA / math), enrollment, tests taken |
| Schools | `schools_search` | Search schools by name, city, district, or level |
| Schools | `schools_compare` | 2–4 schools' published figures side by side — no composite score, no ranking, no winner |

## Where the data comes from

- **Restaurant** answers come from the live API at
  [eat.phalangeai.com](https://eat.phalangeai.com) (9 metros; city and
  county open-data feeds, refreshed daily).
- **Nursing and schools** have no live API. Each line publishes a
  versioned data extract (JSON Lines + a manifest carrying schema
  version, generation time, source vintage, entity count and sha256)
  at a stable URL on its own domain. The server fetches an extract on
  first use, verifies the manifest before trusting a single record,
  caches it for the session, and dates every nursing/schools answer
  with a `data_snapshot` block. An answer that cannot be dated is not
  served; if one vertical's extract cannot be loaded, only that
  vertical's tools refuse — the rest keep working.

Extract locations and the full contract are in
[`umbrella/README.md`](umbrella/README.md); the design is in
[`umbrella/DESIGN.md`](umbrella/DESIGN.md).

## Honesty notes

- Restaurant answers carry a `coverage_status`: `not_covered` means
  Phalange has no data on the business — never that it is clean. Every
  answer carries its official `source_url` and `data_updated_at`.
- Nursing records print CMS's own star ratings with their as-of date,
  null where CMS publishes none; the server invents no rating.
  Penalty totals are reported only when the published extract carries
  penalty fields; the current extract does not carry them, and the
  tools say so rather than estimate.
- School records print each state's own published proficiency measure
  (Massachusetts: MCAS; Texas: STAAR meets-or-above), labelled as that
  state's measure — figures from different states are different
  measures, not a national scale.

## Run the umbrella server

```bash
node umbrella/phalange-mcp.mjs              # stdio (for MCP clients)
node umbrella/phalange-mcp.mjs --http --port 8787   # Streamable HTTP on :8787/mcp
```

### Claude Desktop / Cursor (`mcpServers` JSON)

```json
{
  "mcpServers": {
    "phalange": {
      "command": "node",
      "args": ["/path/to/umbrella/phalange-mcp.mjs"]
    }
  }
}
```

Claude Code: `claude mcp add phalange -- node /path/to/umbrella/phalange-mcp.mjs`.
VS Code uses the same block under a top-level `"servers"` key in
`.vscode/mcp.json`. Environment overrides (`PHALANGE_API_KEY`,
`PHALANGE_CLIENT_TAG`, `PHALANGE_NURSING_EXTRACT_URL`,
`PHALANGE_SCHOOLS_EXTRACT_URL`) are documented in
[`umbrella/README.md`](umbrella/README.md).

## Component: the restaurant-only server

The original single-vertical server is unchanged and remains the
published package for the restaurant registry entry
`com.phalangeai/restaurant-inspections`:

- `mcp-server.mjs` — the server (also served at
  <https://eat.phalangeai.com/mcp-server.mjs>); run it with
  `node mcp-server.mjs` (stdio) or `node mcp-server.mjs --http 8931`.
- `agent-skill.md` — a ready-made restaurant due-diligence Agent Skill
  (also served at <https://eat.phalangeai.com/agent-skill.md>).
- `phalange-inspections.mcpb` — the packaged bundle attached to the
  GitHub releases.
- Its registry metadata is preserved at
  [`restaurant/server.json`](restaurant/server.json); the umbrella's
  metadata is this repository's root `server.json` and
  `umbrella/server.json` (name `com.phalangeai/phalange`).

## Registry status

- `com.phalangeai/restaurant-inspections` — published (v1.0.0 live;
  v1.0.1 prepared).
- `com.phalangeai/phalange` (the umbrella) — prepared in this
  repository and **not yet published**; publication is the repository
  owner's registry action. Both real extracts are wired and the
  dated-answer smoke test passes against them (nursing-20261127-1,
  schools-20261127-1; verified 2026-11-27).

## License & data notes

The server code in this repository is MIT-licensed (see `LICENSE`).
The underlying records are public data from the publishing agencies;
see each record's `source_url`.
