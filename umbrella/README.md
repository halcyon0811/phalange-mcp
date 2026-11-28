# Phalange — umbrella MCP server (all three verticals)

One zero-dependency Node server (`phalange-mcp.mjs`, Node 18+) carrying
all three Phalange public-record verticals. The restaurant-only server
at the repository root remains available and unchanged; this umbrella
includes its four tools verbatim as its restaurant group.

| Group | Tools | Data source |
| --- | --- | --- |
| Restaurant | `restaurant_compliance_lookup`, `restaurant_search`, `restaurant_venue_detail`, `restaurant_risk_summary` | Live API at eat.phalangeai.com |
| Nursing | `nursing_facility_lookup`, `nursing_search`, `nursing_state_summary` | Dated extract published by the nursing line |
| Schools | `schools_school_lookup`, `schools_search`, `schools_compare` | Dated extract published by the schools line |

## How the static verticals work

Nursing and schools have no live API. Each line publishes a versioned
data extract (JSON Lines + a manifest with schema version, generation
time, source vintage, entity count and sha256) at a stable URL on its
own domain. This server fetches a vertical's extract on first use,
verifies the manifest before trusting a single record, caches it for
the session, and dates every nursing/schools answer with a
`data_snapshot` block: `{ vertical, extract_version, generated_at,
source_vintage }`. An answer that cannot be dated is not served; if a
vertical's extract cannot be loaded, only that vertical's tools
refuse — the rest keep working.

Default extract locations (each line confirms or replaces its own
path at publish time; the final paths are recorded here):

- Nursing: `https://nursing.phalangeai.com/mcp-data/nursing-extract.jsonl`
  (proposed; the extract itself is published in the nursing line's
  repository, and this domain path is confirmed when the nursing
  line publishes it there)
- Schools: `https://schools.phalangeai.com/schools-extract.jsonl`
  (confirmed — live, extractVersion schools-20261127-1)

Both are overridable per deployment: `PHALANGE_NURSING_EXTRACT_URL`,
`PHALANGE_SCHOOLS_EXTRACT_URL`. The restaurant group takes
`PHALANGE_API_KEY` (optional — a rate-limited public demo key is
built in) and `PHALANGE_CLIENT_TAG`.

## Caliber rules the server keeps

- Restaurant answers carry the API's `coverage_status`: `not_covered`
  means Phalange has no data on the business — never that it is clean.
- Nursing records print CMS's own star ratings with their as-of date,
  null where CMS publishes none. The server invents no rating.
- School records print each state's own published proficiency measure
  (MA: MCAS; TX: STAAR meets-or-above), labelled as that state's
  measure. `schools_compare` shows published figures side by side —
  no composite score, no ranking, no winner.

## Run it

```bash
node phalange-mcp.mjs              # stdio (for MCP clients)
node phalange-mcp.mjs --http --port 8787   # Streamable HTTP on :8787/mcp
```

Client configuration is the same `mcpServers` shape as the
restaurant-only server (see the repository README), with the command
pointing at `phalange-mcp.mjs`.

## Registry status

This package is prepared for a NEW registry entry,
`com.phalangeai/phalange` (see `server.json` in this directory). It
is **not yet published**. Both real extracts are now wired and the
dated-answer smoke test passes against them (nursing-20261127-1,
schools-20261127-1; verified 2026-11-27); publication itself is the
repository owner's registry action. The existing
`com.phalangeai/restaurant-inspections` entry is unaffected and
remains the listing for the restaurant-only package.
