# venturejobs

venturejobs is for hunting work where the money just landed. It searches open roles at startups whose latest venture round closed within the last six months, and it lets you dig into a single role, read the questions on its application form before you start writing, and research the company behind it — its round, its investors, its headcount and how fast it is hiring.

Around that search sits a small personal workspace. Roles you are considering can go into a tracker with a status, notes and an applied date. Companies you care about can be collected into lists. Searches you run often can be saved so new matches arrive by email. An account tool reports your membership, today's usage and how much you have stored in each of those places.

This package does none of that work on its own machine. It keeps the captured tool definitions locally, answers the tool list from them, and relays every call to the hosted service, returning the reply exactly as it arrived. Nothing here submits an application for you: the form tool only reads a role's questions so answers can be drafted and reviewed, and applying still happens at the role's own apply link.

## Tools

- `search_jobs` — hunt open roles at recently funded startups, with filters for keywords, metro area, country, work mode, function, seniority, funding stage, how recent and how large the latest round was, published pay, company size, industry, investors, posting age and more, plus sorting and paging. No argument is required.
- `get_job` — one role in full: description, pay, the company's round and investors, hiring pace, apply link, the hiring system behind it, and whether the role is already tracked. Required: `job`.
- `get_application_form` — the questions a role's application asks, read from the company's public job board so answers can be drafted for review. Read-only; it never submits anything. Required: `job`.
- `get_company` — a startup's profile: latest round, amount, date, lead investors, headcount, headquarters, hiring pace by function, and every open role. Required: `company`.
- `track_application` — put a role in your tracker or move its status (`saved`, `applied`, `interviewing`, `offer`, `rejected`, `withdrawn`, `archived`), with notes and an applied date; a role found elsewhere can be added from its title, company and apply link. No argument is required.
- `list_applications` — everything in your tracker, with counts by status, optionally narrowed to one status and capped with `limit`.
- `update_application` — change a tracked role's status, replace or append to its notes, or set its applied date. Required: `job`.
- `list_lists` — your company lists, each with its companies' open roles and what is new this week. No arguments.
- `add_to_list` — add a startup to a list chosen by id or by name; a new name creates the list. Required: `company`.
- `remove_from_list` — take a startup off one of your lists. Required: `company`, `list_id`.
- `list_saved_searches` — your saved searches and their filters, with board links. No arguments.
- `save_search` — save a search built from the same filters as `search_jobs`, with an alert cadence of instant, daily, weekly or off. No argument is required.
- `delete_saved_search` — remove one saved search. Required: `id`.
- `get_account` — your membership, today's API usage, and tracker, list and search counts. No arguments.

## Configuration

- `JUSTBACKED_MCP_URL` (optional) — override the upstream endpoint. Defaults to `https://justbacked.com/api/mcp`. (The override hook is this rebuild's own labelled reconstruction.)
- `JUSTBACKED_API_KEY` (optional) — when set, every upstream request carries an `Authorization: Bearer <key>` header carrying your own key. When it is not set, no key header is sent. (The header name is pinned by the original's registry record, which declares a required secret `Authorization` header; the record pins no package env name, so the Bearer form and forwarding the key from this env var are labelled reconstructions — the original surface was captured keyless.)

### Forwarding mechanics

The first tool call opens a streamable HTTP session upstream: a JSON-RPC `initialize` request (protocolVersion `2025-03-26`, clientInfo name `venturejobs`), then a `notifications/initialized` notification, then the `tools/call` request with your arguments unchanged. If the upstream answers `initialize` with an `Mcp-Session-Id` header, that value rides on every later request, and the session is reused for the life of the process. Replies may arrive as plain JSON or as server-sent events; both are read.

Successful upstream results pass through verbatim, including any `isError` flag the upstream sets. Failures — a JSON-RPC error, a non-2xx status, an unreadable response, or a request that cannot be completed — come back as an `isError` result whose text starts with `venturejobs error:` (this rendering is this rebuild's own labelled reconstruction).

## CLI

Each tool is also a subcommand taking one JSON argument string:

```bash
npx @reneturcios/venturejobs search_jobs '{"query":"founding engineer","cities":["sf"]}'
npx @reneturcios/venturejobs get_job '{"job":"some-role-slug"}'
npx @reneturcios/venturejobs get_account '{}'
npx @reneturcios/venturejobs --version
```

Exit codes: `0` on success, `1` on an `isError` result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/venturejobs mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "venturejobs": {
      "command": "npx",
      "args": ["-y", "@reneturcios/venturejobs", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/venturejobs
docker run --rm ghcr.io/cloudcorprecords/venturejobs --version
```

The container's default command is `mcp`, so the first form is a stdio MCP server; any other arguments reach the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.
