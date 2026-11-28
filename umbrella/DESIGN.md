# Umbrella Phalange MCP server — design + data-extract spec

Prepared 2026-11-27 (eat line, umbrella owner). Alex's ruling: ONE
umbrella server for all three verticals; the phalange-mcp package
grows into it. This document is the design + the extract contract
for the nursing and schools lines. No skeleton is built until
coordination has this design.

## 1. Shape

One server file (`phalange-mcp.mjs`, zero-dependency Node ≥18, same
engineering pattern as the restaurant server), three tool groups:

- Restaurant (UNCHANGED): the existing 4 tools proxying the live API
  at eat.phalangeai.com/api/v1 — restaurant_compliance_lookup,
  restaurant_search, restaurant_venue_detail, restaurant_risk_summary.
  No behavior change, no rename.
- Nursing (NEW, static-extract backed): nursing_facility_lookup,
  nursing_search, nursing_state_summary.
- Schools (NEW, static-extract backed): schools_school_lookup,
  schools_search, schools_compare.

Transports: stdio + Streamable HTTP, identical to the existing
server. Total tool count 10 — well inside client comfort.

## 2. How the static verticals get their data — fetch-on-first-use

Nursing and schools have no live API; their corpora live behind
static sites. The umbrella does NOT embed their data in the bundle:

- Each line publishes ONE versioned extract (files per §4) at a
  stable URL on its own domain.
- The umbrella fetches a vertical's extract the first time one of
  its tools is called in a session, verifies the manifest
  (schemaVersion + sha256), and caches it in memory for the session.
- If a fetch fails, that vertical's tools answer plainly that the
  extract is unavailable; the other verticals keep working.
- Every nursing/schools answer carries its snapshot block:
  { extract_version, generated_at, source_vintage } — an answer
  that cannot be dated is not served.

Why not embedded: honest size estimates are nursing ≈5–7 MB and
schools ≈4–6 MB of summary records (see §4 budgets) — a 10–13 MB
bundle hurts download/install for data that also goes stale inside
the bundle. Fetched: the bundle stays <100 KB, extracts refresh on
each line's own deploy cadence, and snapshot dating is structural.
Hosting input for coordination's ruling: v1 needs NO hosted
endpoint (the proven local/bundle route). A hosted HTTP endpoint
becomes relevant only for connector-style distribution later
(Glama's hourly registry sync covers Streamable HTTP endpoints);
it is not a v1 dependency and nothing in this design blocks it.

## 3. Registry + versioning story (truthfulness rule)

- The existing entry com.phalangeai/restaurant-inspections STAYS,
  unchanged and truthful: it describes the restaurant-only package,
  which continues to exist and be served.
- The umbrella is a NEW entry: com.phalangeai/phalange (name to be
  confirmed at publish time), its own server.json, its own version
  line starting at 1.0.0, its own .mcpb asset
  (phalange-umbrella.mcpb) on the phalange-mcp repo.
- The repo carries both packages: mcp-server.mjs (restaurant, v1.x)
  and phalange-mcp.mjs (umbrella). The umbrella's README section
  states plainly that the restaurant-only package remains available
  and that the umbrella includes it verbatim as its restaurant
  group. No silent stretching of the old entry's description.
- Extract schemaVersion is independent of server version. The
  server refuses an extract whose schemaVersion it does not
  understand and says so in the answer — never a silent misread.

## 4. The data-extract spec (the contract for the nursing + schools lines)

Each line delivers, at a stable HTTPS URL on its own domain:
- `<name>-extract.jsonl` — one JSON object per entity, UTF-8.
- `<name>-extract.manifest.json`:
  { schemaVersion: 1, extractVersion: "<line>-<yyyymmdd>-<n>",
    generatedAt: ISO-8601, sourceVintage: "<human label, e.g. CMS
    Provider Data Nov 2026 / MCAS 2026 + TAPR 2024>",
    entityCount: N, sha256: "<hex of the .jsonl>", fields: [...] }

Budgets (hard): ≤10 MB uncompressed per vertical (targets:
nursing ≤7 MB, schools ≤6 MB); one summary record per entity —
NO full histories, NO violation-level detail, NO narrative text.
Refresh cadence: regenerate + republish on the line's own data
refresh (nursing: its CMS refresh cycle; schools: on data change —
their sources are annual, so the manifest's sourceVintage carries
the year honestly). Snapshot dating rides every record's answer
via the manifest block (§2).

### Nursing record (per facility)
ccn, name, address, city, state, zip, status ("active"|"closed"),
cmsStars { overall, health, staffing, quality, asOf } — CMS's own
published ratings, null where CMS publishes none (SFF facilities:
overall null, never a substitute), latestSurveyDate,
deficiencyCountLatest (count on the most recent standard survey),
penalties { count, totalAmount } over the stored record,
complaintSurveyShare? — ONLY fields the line's corpus stores
verbatim; the line strikes any field it cannot fill truthfully
rather than approximating it. Caliber inheritance: the server
prints CMS stars as sourced data with their as-of, and invents no
rating of its own.

### Schools record (per school)
state ("MA"|"TX"), schoolId (state code), name, district, city,
level, enrollment, testsTaken, dataYear, elaProficiencyPct,
mathProficiencyPct (the state's published proficiency measure —
MA: MCAS meeting-or-exceeding; TX: STAAR meets-or-above, labelled
as each state's own measure, never blended), avgSgp (MA only,
null for TX). Caliber inheritance: NO composite score, NO ranking,
NO winner anywhere — schools_compare returns the published figures
side by side, exactly like the lines' own compare tool.

## 5. Tool contracts (static groups)

- *_lookup: name (+ state/city disambiguators) → best matches with
  the full summary record + snapshot block. Ambiguity returns the
  candidate list, never a silent pick.
- *_search: browse by state/city/ZIP/district with a result cap;
  returns summary records + snapshot block.
- nursing_state_summary: per-state aggregates computed FROM the
  extract (facility count, status split, penalty totals) + the
  snapshot block — labelled as extract-derived.
- schools_compare: 2–4 named schools → published figures side by
  side + snapshot block; refuses <2 or >4.

## 6. What I need from coordination / the lines

1. Confirmation of the umbrella registry name
   (com.phalangeai/phalange proposed).
2. Each line's extract + manifest at its stable URL, against §4 —
   with any field struck, named in their delivery note.
3. The hosting ruling (my input is in §2: no endpoint needed for
   v1) — needed before the skeleton build only insofar as it
   changes the transport defaults; it does not.

After the design is accepted: I build the skeleton (restaurant
group wired live; nursing/schools groups wired to the extract
loader with the manifest checks), smoke-test against each line's
first extract, and the publish sequence ends at Alex's OAuth,
exactly like v1.0.1's.
