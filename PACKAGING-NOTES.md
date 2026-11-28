# Packaging notes — phalange-mcp refresh (prepared 2026-11-27, eat line)

State found: the public repo github.com/halcyon0811/phalange-mcp already
exists (created 2026-11-26 for the official Registry publish). Its files
were stale against the live surface by exactly one change: the API
attribution work (X-Phalange-Client header + VERSION/CLIENT_TAG
constants) and the corrected agent-skill text. This tree is the repo's
content refreshed to the live bytes, plus the missing pieces.

Tree contents (all verified against the live surface 2026-11-27):
- mcp-server.mjs — byte-identical to https://eat.phalangeai.com/mcp-server.mjs
  (8,966B). Smoke-tested: initialize + tools/list answer with the four
  live tools (restaurant_compliance_lookup, restaurant_search,
  restaurant_venue_detail, restaurant_risk_summary), serverInfo
  phalange-restaurant-inspection / 1.0.0.
- agent-skill.md — byte-identical to the live served skill (5,934B).
- smithery.yaml — carried over unchanged (stdio start command, optional
  apiKey config mapped to PHALANGE_API_KEY).
- README.md — repo README + Windsurf and VS Code config blocks + a
  Streamable HTTP hosting section; license pointer fixed.
- LICENSE — HELD, not in the repo: an MIT text was prepared, but a
  license is a legal grant on the owner's code and lands only on the
  owner's explicit confirmation (coordination ruling 2026-11-27).
  Until then the README carries the repo's original "may be used
  freely" wording and no license file is present.
- manifest.json — the MCPB manifest, unchanged from v1.0.0.
- phalange-inspections.mcpb — REBUILT from the live server file.
  New sha256: c164d76f19ea6395e6f3fadfb87dea90bfeb9159e03d370a8cefef008694ce3f
  Registry v1.0.0 entry carries the OLD bundle's sha256
  (d3cbb445…): the registry refresh sequence is — push this tree to
  the repo, cut a v1.0.1 GitHub release with the new bundle, publish
  server.json at version 1.0.1 with the new fileSha256 via
  mcp-publisher (GitHub OAuth as halcyon0811 = Alex's step).
- server.json — the registry source file, matching the LIVE entry
  exactly (name com.phalangeai/restaurant-inspections, title,
  description, version 1.0.0, websiteUrl, mcpb package). Registry
  verification 2026-11-27: entry status active, isLatest, metadata
  matches the current server (4 tools, 9 metros, demo-key env var).

Write-access blocker: the coordination PAT is fine-grained to
ai-developer / school-lookup / nursing-home-inspection and cannot
write phalange-mcp. To land this tree, ONE of: (a) Alex adds
phalange-mcp to the PAT's repository set (one settings screen), then
Ember pushes via the helper with no further prompts; or (b) the tree
is pushed by whoever holds write access. Nothing else in the package
needs an account step.

Caliber: every public claim in the tree is the live surface — 9
metros, 4 tools, demo key rate-limited (60/min, 300/day per IP),
coverage_status semantics, LA/SCC feeds stale at the source. No new
capability is claimed anywhere.
