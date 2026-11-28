# Phalange — Restaurant Inspection MCP Server & Agent Skill

An MCP server and Agent Skill that give AI agents access to **official
restaurant health-inspection records** for 9 US metros (Boston, New York
City, Chicago, Austin, Los Angeles County, Santa Clara County, Las
Vegas / Clark County, Miami-Dade, Cambridge MA), served by
[eat.phalangeai.com](https://eat.phalangeai.com). Data comes from
city/county open-data feeds and is refreshed daily.

## Tools

| Tool | What it does |
| --- | --- |
| `restaurant_compliance_lookup` | Business name + address → match confidence, coverage status, latest inspection result, violation count, critical violations, closure status, source URL |
| `restaurant_search` | Search venues in one metro by name |
| `restaurant_venue_detail` | One venue's inspection history and latest violation lines |
| `restaurant_risk_summary` | Per-metro aggregates: venues, inspections and failures in a time window |

The compliance lookup answers with a `coverage_status` instead of
guessing: `not_covered` means no data (never "the restaurant is
clean"), and every answer carries its official `source_url` and
`data_updated_at`.

## Run the MCP server

Zero dependencies, Node.js 18+. Download `mcp-server.mjs` (also served
at <https://eat.phalangeai.com/mcp-server.mjs>) and:

```bash
node mcp-server.mjs            # stdio (for MCP clients)
node mcp-server.mjs --http 8931  # stateless Streamable HTTP on :8931/mcp
```

A public demo API key is built in. To use your own key, set
`PHALANGE_API_KEY`. Full API docs: <https://eat.phalangeai.com/api-docs.html>

### Claude Code

```bash
claude mcp add phalange-inspections -- node /path/to/mcp-server.mjs
```

### Claude Desktop / Cursor (`mcpServers` JSON)

```json
{
  "mcpServers": {
    "phalange-inspections": {
      "command": "node",
      "args": ["/path/to/mcp-server.mjs"]
    }
  }
}
```

### Windsurf

Add the same block to `~/.codeium/windsurf/mcp_config.json` (Windsurf uses
the `mcpServers` shape above).

### VS Code (`.vscode/mcp.json` or user `mcp.json`)

```json
{
  "servers": {
    "phalange-inspections": {
      "command": "node",
      "args": ["/path/to/mcp-server.mjs"]
    }
  }
}
```

### Remote / hosted (Streamable HTTP)

The same file serves stateless Streamable HTTP when started with
`node mcp-server.mjs --http --port 8787` (endpoint: `POST /mcp`). Host it
anywhere Node 18+ runs; clients that accept a remote MCP URL can then
point at it instead of spawning the file locally. Set `PHALANGE_API_KEY`
in the server's environment to use a non-demo key, and
`PHALANGE_CLIENT_TAG` to label your traffic in the API's metering.

## Umbrella server (all three verticals)

The `umbrella/` directory carries the umbrella Phalange server
(`phalange-mcp.mjs`): the four restaurant tools above, plus
nursing-home and public-school tool groups that read dated data
extracts published by those lines. It is prepared for a new registry
entry, `com.phalangeai/phalange`, and is **not yet published** —
publication is held until both real extracts are wired and verified.
See `umbrella/README.md` for the design and the caliber rules.

## Agent Skill

`agent-skill.md` is a ready-made restaurant due-diligence skill
(SKILL.md format): compliance lookup first, coverage discipline,
closure signals, sourced conclusions. Also served at
<https://eat.phalangeai.com/agent-skill.md>.

## License & data notes

The server code in this repository is MIT-licensed (see `LICENSE`).
Inspection records are public data from the publishing agencies;
see each record's `source_url`.
