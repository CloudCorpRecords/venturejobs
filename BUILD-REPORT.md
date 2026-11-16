# BUILD-REPORT — venturejobs

Rebuild of `com.justbacked/jobs` v1.0.0 (remote-only MCP server at
`https://justbacked.com/api/mcp`) as a local forwarding client.
Package: `@reneturcios/venturejobs` 0.1.0, MCP name
`io.github.CloudCorpRecords/venturejobs`.

## Surface built

- Full surface built: **14/14 tools**, no omissions.
- Served tools/list deep-equals the fixture
  `harness/fixtures/justbacked-tools-original.json` tool objects
  verbatim, in order. The literals were generated programmatically
  (parse + re-serialise) by `/tmp/b39-venturejobs-gen.py` — never
  retyped.
- Tools are registered via the MCP SDK low-level Server API
  (ListToolsRequestSchema / CallToolRequestSchema handlers), not
  McpServer+zod, per the task override of TEMPLATE.md §2 item 12.

## Fixture conflicts

- None. The spec's tool list, required fields, endpoint, and
  server.json description all match the fixture. One test-authoring
  note (not a fixture conflict): in the fixture, array-typed filter
  enums such as `work_modes` live under `items.enum`, not a top-level
  `enum` — the test suite asserts them there.

## Required fields as served, per tool

- `search_jobs` — NO `required` key
- `get_job` — required: `job`
- `get_application_form` — required: `job`
- `get_company` — required: `company`
- `track_application` — NO `required` key
- `list_applications` — NO `required` key
- `update_application` — required: `job`
- `list_lists` — NO `required` key
- `add_to_list` — required: `company`
- `remove_from_list` — required: `company`, `list_id`
- `list_saved_searches` — NO `required` key
- `save_search` — NO `required` key
- `delete_saved_search` — required: `id`
- `get_account` — NO `required` key

Every tool serves exactly the keys `name`, `title`, `description`,
`inputSchema`, in that order.

## Labelled reconstructions (from the spec's Wire section)

- Upstream endpoint pinned: `https://justbacked.com/api/mcp`.
- Env override `JUSTBACKED_MCP_URL` — LABELLED RECONSTRUCTION.
- Env name `JUSTBACKED_API_KEY` — LABELLED RECONSTRUCTION (the
  registry record pins no package env name; the capture was keyless).
  When set, every upstream request sends
  `Authorization: Bearer <value>` (header NAME pinned by the registry
  record's own remote declaration; the Bearer form and the env
  forwarding are LABELLED RECONSTRUCTIONS). When unset, no key header
  is sent. Both branches are tested.
- Upstream failures surface as `venturejobs error:` text — LABELLED
  RECONSTRUCTION.

## Wire behaviour

- tools/call forwarded as streamable-HTTP JSON-RPC: initialize
  (protocolVersion 2025-03-26, clientInfo venturejobs/0.1.0) →
  notifications/initialized → tools/call, honouring Mcp-Session-Id
  when issued, session reused for the client's life.
- Plain-JSON and SSE replies are both parsed; the message whose id
  matches the request wins. Upstream results pass through verbatim,
  including `isError` and extra fields.
- Core takes an injectable fetch; tests stub the upstream — no live
  network calls in tests.

## Lockfile

- Route: **Route 3** — `npm install --package-lock-only
  --ignore-scripts --offline`, run in the build dir with NO
  node_modules and NO pre-existing lockfile.
- Entries: **128** packages; name `@reneturcios/venturejobs`.
- sha256: `f3075dc474ffd90a9aaf57e9c3b79482afec0006826eef78e74b80dd5d30ad8c`
- node_modules then installed with `npm install --offline
  --ignore-scripts`.

## Verification

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli, forward, index, mcp, types;
  .js + .d.ts + maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand → usage
  on stderr, exit 2
- `npm test` → **63 tests, 63 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's 14 tool objects,
  names in order, exact keys per tool, required fields per tool,
  search_jobs property order, items-enum and direct-enum literals,
  the form tool's never-submits wording, empty-schema tools,
  isKnownTool; session establishment/reuse, session-id handling,
  clientInfo/protocol version; env URL override, explicit-over-env
  precedence, blank-env fallback; Authorization Bearer present on
  every request when the key is set / absent when unset or blank /
  no X-API-Key header in either case; verbatim argument forwarding;
  verbatim result pass-through incl. upstream isError and SSE;
  JSON-RPC/init/malformed/no-result/HTTP/throw/timeout failures →
  `venturejobs error:`; parseRpcBody JSON + SSE + matching-id +
  [DONE] cases; MCP-layer MethodNotFound / InvalidParams validation;
  CLI --version / -v / unknown exit 2 / bad-JSON exit 2 /
  `mcp extra` exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/justbacked-tools-original.json --rebuild
  "stdio:node builds/venturejobs/dist/cli.js mcp" --out
  builds/venturejobs/parity-out` (run from
  `~/workspace/mcp-rebuild-100`) → **PASS, parity 100.0, 14/14
  identical, no missing/extra/schema diffs** (see
  `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at 75 chars; OCI entry
  confirmed to have no `version` field.

Clean-room: all prose and code written fresh for venturejobs; only
the mechanics were patterned on the sibling imgpage build (same
forwarding-client class), and only the fixture's tool literals are
served verbatim.
