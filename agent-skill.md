---
name: restaurant-due-diligence
description: Check a restaurant's public health-inspection record before recommending, booking, contracting, or writing about it. Given a business name and address, query the Phalange Restaurant Inspection API and produce a sourced compliance conclusion. Use whenever a task involves vetting a food business in Boston, New York City, Chicago, Austin, LA County, Santa Clara County, Las Vegas, Miami-Dade, or Cambridge MA.
---

# Restaurant due diligence

Public inspection records are the ground truth for "is this place
in good standing" questions — not reviews, not ratings. This skill
runs one business (or a short list) through the Phalange Restaurant
Inspection API at `https://eat.phalangeai.com` and turns the answer
into a conclusion a human can act on, with the source attached.

## Access

- Base URL: `https://eat.phalangeai.com`
- Auth: `Authorization: Bearer demo-phalange` (published demo key;
  metered, rate-limited, free). Production keys are issued per
  buyer — see https://eat.phalangeai.com/api-docs.html
- Machine-readable contract: `GET /api/v1/openapi.json` (no auth)
- MCP alternative: the same four operations are packaged as an MCP
  server (`mcp-server.mjs`, stdio + HTTP) at
  https://eat.phalangeai.com/mcp-server.mjs — prefer the MCP tools
  (`restaurant_compliance_lookup`, `restaurant_search`,
  `restaurant_venue_detail`, `restaurant_risk_summary`) when they
  are available in your environment.

## Workflow

1. **Start with the compliance lookup** — one call answers most
   questions:
   `GET /api/v1/compliance/lookup?name=<name>&address=<address>` (add
   `&city=<cityId>` when the city is known; omit it to search all
   covered cities).
2. **Read `coverage_status` before anything else:**
   - `covered` — we hold records for this business; interpret them.
   - `stale` — matched, but that city's government feed has stalled
     (currently LA County and Santa Clara County). Report the record
     AND its staleness; do not present it as current.
   - `not_covered` — we have **no data** on this business. Every
     inspection field is `null`. Say exactly that. **Never** convert
     not_covered into "no violations" or "clean record" — absence of
     coverage is not evidence of compliance.
3. **Interpret the record** (only when covered/stale):
   - `entity_match_confidence` below 0.8 (`matchLevel` medium/low):
     name the uncertainty — the record may belong to a similarly
     named business. Cross-check with `restaurant_search` and, if
     still ambiguous, say so instead of concluding.
   - `closure_status: "closed_at_latest_inspection"` is the single
     strongest signal — lead with it.
   - `critical_violations` counts violation lines on the latest
     inspection **when that inspection failed or closed the venue**
     under the city's own result scale (the response carries the
     definition verbatim in `critical_definition`). It is not a
     cross-city severity score; never rank businesses in different
     cities by it.
   - Results are each city's own scale (letter grades, scores,
     Pass/Fail). Report the scale you were given; do not translate
     it into a universal "safe/unsafe" verdict.
4. **Go deeper only when the question needs it:**
   - Full timeline + the latest inspection's violation lines:
     `GET /api/v1/venues/<cityId>/<venueKey>` (or the
     `restaurant_venue_detail` MCP tool). Violation text exists
     only for the latest inspection — say so when summarizing older
     history, which carries dates, results and counts only.
   - Area/portfolio context: `GET /api/v1/risk-summary?city=<cityId>`
     — 30-day inspections, failures and failure rate for the city.
5. **Write the conclusion with its provenance:** business name and
   address as matched, latest inspection date, result in the city's
   own scale, the one or two facts that drive the conclusion, and
   `source_url` + `data_updated_at` from the response. If the data
   is stale or the match is weak, the caveat goes in the first
   sentence, not a footnote.

## Hard rules

- Never call a business "dirty", "unsafe", or "clean". The records
  support "failed its most recent inspection on <date>" and "no
  failed inspection in the stored record" — nothing stronger.
- Austin and Miami-Dade publish no violation text at all; a covered
  answer from those cities rests on results/scores alone.
- A `not_covered` result ends the check: report no coverage, offer
  the city's official lookup from `source_url` as the fallback, and
  do not fill the gap with web reviews.
