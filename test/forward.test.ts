import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  VenturejobsClient,
  callTool,
  createClient,
  DEFAULT_ENDPOINT_URL,
  isKnownTool,
  parseRpcBody,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolDef,
  ToolResult,
} from "../src/types.js";

/**
 * Every test here talks to a stubbed JSON-RPC upstream that
 * plays the streamable-HTTP session flow
 * (initialize -> notifications/initialized -> tools/call).
 * No live network is used and the real endpoint is never
 * contacted.
 */

const FIXTURE_URL = new URL(
  "../../../harness/fixtures/justbacked-tools-original.json",
  import.meta.url,
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_URL);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(FIXTURE_URL, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};
/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}

/** Recursively strip `description` fields (tool- and parameter-level).
 * Ruling 1 (2026-11-04): the served tools carry parameter descriptions
 * added over the original capture; everything else must match exactly. */
function stripDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDescriptions);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k !== "description") out[k] = stripDescriptions(v);
    }
    return out;
  }
  return value;
}


const EXPECTED_NAMES = [
  "search_jobs",
  "get_job",
  "get_application_form",
  "get_company",
  "track_application",
  "list_applications",
  "update_application",
  "list_lists",
  "add_to_list",
  "remove_from_list",
  "list_saved_searches",
  "save_search",
  "delete_saved_search",
  "get_account",
];

const EXPECTED_REQUIRED: Record<string, string[] | undefined> = {
  search_jobs: undefined,
  get_job: ["job"],
  get_application_form: ["job"],
  get_company: ["company"],
  track_application: undefined,
  list_applications: undefined,
  update_application: ["job"],
  list_lists: undefined,
  add_to_list: ["company"],
  remove_from_list: ["company", "list_id"],
  list_saved_searches: undefined,
  save_search: undefined,
  delete_saved_search: ["id"],
  get_account: undefined,
};

const SAMPLE_RESULT = {
  content: [{ type: "text", text: "{\"total\":1,\"jobs\":[{\"title\":\"Founding Engineer\"}]}" }],
  structuredContent: { total: 1 },
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOptions {
  callResult?: Record<string, unknown>;
  callBodyText?: string;
  callError?: Record<string, unknown>;
  callStatus?: number;
  initError?: Record<string, unknown>;
  initStatus?: number;
  initBodyText?: string;
  throwOn?: "initialize" | "tools/call";
  sessionId?: string | null;
  hangOnCall?: boolean;
  sse?: boolean;
}

function makeResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lowered = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => bodyText,
  };
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return makeResponse(status, JSON.stringify(payload), headers);
}

function makeUpstream(options: FakeOptions = {}): {
  fetchFn: FetchFn;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (options.throwOn === method) throw new Error("socket hang up");
    if (method === "initialize") {
      if (options.initBodyText !== undefined) {
        return makeResponse(options.initStatus ?? 200, options.initBodyText);
      }
      if (options.initError !== undefined) {
        return jsonResponse(options.initStatus ?? 200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.initError,
        });
      }
      const headers: Record<string, string> = {};
      const sessionId =
        options.sessionId === undefined ? "sess-abc" : options.sessionId;
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      return jsonResponse(
        options.initStatus ?? 200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "jobs", version: "1.0.0" },
          },
        },
        headers,
      );
    }
    if (method === "notifications/initialized") {
      return makeResponse(202, "");
    }
    if (method === "tools/call") {
      if (options.hangOnCall) {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (options.callBodyText !== undefined) {
        return makeResponse(options.callStatus ?? 200, options.callBodyText);
      }
      if (options.callError !== undefined) {
        return jsonResponse(options.callStatus ?? 200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.callError,
        });
      }
      const result = options.callResult ?? SAMPLE_RESULT;
      if (options.sse) {
        const payload = JSON.stringify({ jsonrpc: "2.0", id: body.id, result });
        return makeResponse(
          options.callStatus ?? 200,
          `event: message\ndata: ${payload}\n\n`,
          { "content-type": "text/event-stream" },
        );
      }
      return jsonResponse(options.callStatus ?? 200, {
        jsonrpc: "2.0",
        id: body.id,
        result,
      });
    }
    throw new Error(`unexpected method ${method}`);
  };
  return { fetchFn, calls };
}

function firstText(result: ToolResult): string {
  const content = result.content as Array<{ text?: string }>;
  return content[0].text ?? "";
}

/* ------------------------------------------------------------------ */

describe("registration integrity (captured surface)", () => {
  it("serves exactly the fixture's tool objects, deep-equal and in order", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.deepEqual(stripDescriptions(TOOL_DEFS), stripDescriptions(fixture.tools));
  });

  it("serves 14 tools", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(TOOL_DEFS.length, 14);
    assert.equal(fixture.tools.length, 14);
  });

  it("serves the tool names in the captured order", () => {
    assert.deepEqual(TOOL_NAMES, EXPECTED_NAMES);
  });

  it("every tool carries exactly the fixture's keys, in order", () => {
    for (const tool of TOOL_DEFS) {
      assert.deepEqual(Object.keys(tool), [
        "name",
        "title",
        "description",
        "inputSchema",
      ]);
    }
  });

  it("serves the required fields exactly as captured, per tool", () => {
    for (const tool of TOOL_DEFS) {
      const schema = tool.inputSchema as { required?: string[] };
      assert.deepEqual(schema.required, EXPECTED_REQUIRED[tool.name], tool.name);
    }
  });

  it("search_jobs carries no required key in its served schema", () => {
    const schema = TOOL_DEFS[0].inputSchema as Record<string, unknown>;
    assert.equal("required" in schema, false);
  });

  it("remove_from_list requires company and list_id in that order", () => {
    const tool = TOOL_DEFS.find((t) => t.name === "remove_from_list")!;
    assert.deepEqual(
      (tool.inputSchema as { required?: string[] }).required,
      ["company", "list_id"],
    );
  });

  it("search_jobs exposes the full captured filter property set", () => {
    const props = Object.keys(
      (TOOL_DEFS[0].inputSchema as { properties: object }).properties,
    );
    assert.deepEqual(props, [
      "query", "search_descriptions", "cities", "location", "countries",
      "work_modes", "functions", "seniority", "stages", "raised_within_days",
      "min_raise_usd", "min_pay_usd", "has_pay", "company_sizes", "industries",
      "investors", "posted_within_hours", "hiring_fast", "employment",
      "exclude_title_words", "list_id", "include_non_venture", "sort",
      "limit", "offset",
    ]);
  });

  it("work_modes items enum is remote/hybrid/onsite as captured", () => {
    const props = (TOOL_DEFS[0].inputSchema as { properties: Record<string, { items?: { enum?: string[] } }> }).properties;
    assert.deepEqual(props.work_modes.items?.enum, ["remote", "hybrid", "onsite"]);
  });

  it("status enum on track_application matches the captured statuses", () => {
    const tool = TOOL_DEFS.find((t) => t.name === "track_application")!;
    const props = (tool.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
    assert.deepEqual(props.status.enum, [
      "saved", "applied", "interviewing", "offer", "rejected", "withdrawn", "archived",
    ]);
  });

  it("save_search alert enum matches the captured cadences", () => {
    const tool = TOOL_DEFS.find((t) => t.name === "save_search")!;
    const props = (tool.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
    assert.deepEqual(props.alert.enum, ["instant", "daily", "weekly", "off"]);
  });

  it("get_application_form states in its description that it never submits", () => {
    const tool = TOOL_DEFS.find((t) => t.name === "get_application_form")!;
    assert.match(tool.description, /never submits anything/);
  });

  it("empty-schema tools serve an empty properties object", () => {
    for (const name of ["list_lists", "list_saved_searches", "get_account"]) {
      const tool = TOOL_DEFS.find((t) => t.name === name)!;
      assert.deepEqual(
        (tool.inputSchema as { properties: unknown }).properties,
        {},
        name,
      );
    }
  });

  it("isKnownTool accepts every captured name and rejects others", () => {
    for (const name of EXPECTED_NAMES) assert.equal(isKnownTool(name), true, name);
    assert.equal(isKnownTool("apply_for_job"), false);
    assert.equal(isKnownTool(""), false);
  });

  it("VERSION is 0.1.0", () => {
    assert.equal(VERSION, "0.1.0");
  });
});

/* ------------------------------------------------------------------ */

describe("session establishment and reuse", () => {
  it("opens with initialize, then notifications/initialized, then tools/call", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await c.callTool("get_account", {});
    assert.deepEqual(
      upstream.calls.map((x) => x.body.method),
      ["initialize", "notifications/initialized", "tools/call"],
    );
  });

  it("initialize carries protocolVersion 2025-03-26 and venturejobs clientInfo", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await c.callTool("get_account", {});
    const params = upstream.calls[0].body.params as {
      protocolVersion: string;
      clientInfo: { name: string; version: string };
    };
    assert.equal(params.protocolVersion, "2025-03-26");
    assert.equal(params.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(params.clientInfo, { name: "venturejobs", version: "0.1.0" });
  });

  it("sends the issued Mcp-Session-Id on the notification and the call", async () => {
    const upstream = makeUpstream({ sessionId: "sess-999" });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await c.callTool("get_account", {});
    assert.equal(upstream.calls[0].headers["Mcp-Session-Id"], undefined);
    assert.equal(upstream.calls[1].headers["Mcp-Session-Id"], "sess-999");
    assert.equal(upstream.calls[2].headers["Mcp-Session-Id"], "sess-999");
  });

  it("sends no session header when the upstream issues none", async () => {
    const upstream = makeUpstream({ sessionId: null });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await c.callTool("get_account", {});
    for (const call of upstream.calls) {
      assert.equal(call.headers["Mcp-Session-Id"], undefined);
    }
  });

  it("reuses one session across two calls", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await c.callTool("get_account", {});
    await c.callTool("list_lists", {});
    assert.equal(upstream.calls.length, 4);
    assert.equal(
      upstream.calls.filter((x) => x.body.method === "initialize").length,
      1,
    );
  });

  it("posts to the pinned default endpoint", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await c.callTool("get_account", {});
    assert.equal(DEFAULT_ENDPOINT_URL, "https://justbacked.com/api/mcp");
    for (const call of upstream.calls) assert.equal(call.url, DEFAULT_ENDPOINT_URL);
  });

  it("honours the JUSTBACKED_MCP_URL env override", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: { JUSTBACKED_MCP_URL: "https://example.test/mcp" },
    });
    await c.callTool("get_account", {});
    for (const call of upstream.calls) {
      assert.equal(call.url, "https://example.test/mcp");
    }
  });

  it("an explicit url beats the env override", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: { JUSTBACKED_MCP_URL: "https://example.test/env" },
      url: "https://example.test/explicit",
    });
    await c.callTool("get_account", {});
    assert.equal(upstream.calls[0].url, "https://example.test/explicit");
  });

  it("a blank env override falls back to the pinned default", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: { JUSTBACKED_MCP_URL: "   " },
    });
    await c.callTool("get_account", {});
    assert.equal(upstream.calls[0].url, DEFAULT_ENDPOINT_URL);
  });
});

/* ------------------------------------------------------------------ */

describe("upstream key header", () => {
  it("sends Authorization Bearer on every request when the key is set", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: { JUSTBACKED_API_KEY: "jb-test-key" },
    });
    await c.callTool("get_account", {});
    assert.equal(upstream.calls.length, 3);
    for (const call of upstream.calls) {
      assert.equal(call.headers["Authorization"], "Bearer jb-test-key");
    }
  });

  it("sends no Authorization header when the key is unset", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await c.callTool("get_account", {});
    for (const call of upstream.calls) {
      assert.equal(call.headers["Authorization"], undefined);
    }
  });

  it("treats a blank key as unset", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: { JUSTBACKED_API_KEY: "  " },
    });
    await c.callTool("get_account", {});
    for (const call of upstream.calls) {
      assert.equal(call.headers["Authorization"], undefined);
    }
  });

  it("never sends an X-API-Key header in either branch", async () => {
    for (const env of [{ JUSTBACKED_API_KEY: "k" }, {}]) {
      const upstream = makeUpstream();
      const c = createClient({ fetchFn: upstream.fetchFn, env });
      await c.callTool("get_account", {});
      for (const call of upstream.calls) {
        assert.equal(call.headers["X-API-Key"], undefined);
      }
    }
  });
});

/* ------------------------------------------------------------------ */

describe("tools/call forwarding", () => {
  it("forwards search_jobs arguments verbatim", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const args = {
      query: "founding engineer",
      cities: ["sf", "nyc"],
      work_modes: ["remote"],
      stages: ["seed", "a"],
      min_raise_usd: 5000000,
      limit: 10,
    };
    await c.callTool("search_jobs", args);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "search_jobs");
    assert.deepEqual(params.arguments, args);
  });

  it("forwards get_job arguments verbatim", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await c.callTool("get_job", { job: "https://justbacked.com/jobs/abc" });
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, { job: "https://justbacked.com/jobs/abc" });
  });

  it("forwards remove_from_list arguments verbatim", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await c.callTool("remove_from_list", { company: "acme", list_id: "L1" });
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, { company: "acme", list_id: "L1" });
  });

  it("forwards an empty argument object for get_account", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await c.callTool("get_account", {});
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, {});
  });

  it("returns the upstream result verbatim, extra fields included", async () => {
    const rich = {
      content: [{ type: "text", text: "hi" }],
      structuredContent: { total: 3 },
      _meta: { trace: "t-1" },
    };
    const upstream = makeUpstream({ callResult: rich });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("search_jobs", {});
    assert.deepEqual(out, rich);
  });

  it("passes an upstream isError result through unchanged", async () => {
    const errResult = {
      content: [{ type: "text", text: "upstream says no" }],
      isError: true,
    };
    const upstream = makeUpstream({ callResult: errResult });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("get_job", { job: "x" });
    assert.deepEqual(out, errResult);
  });

  it("reads an SSE-framed call reply", async () => {
    const upstream = makeUpstream({ sse: true });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("list_applications", {});
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("the one-shot callTool helper forwards through a fresh client", async () => {
    const upstream = makeUpstream();
    const out = await callTool(
      "get_company",
      { company: "acme" },
      { fetchFn: upstream.fetchFn, env: {} },
    );
    assert.deepEqual(out, SAMPLE_RESULT);
    assert.equal(upstream.calls.length, 3);
  });

  it("VenturejobsClient can be constructed directly", async () => {
    const upstream = makeUpstream();
    const c = new VenturejobsClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("list_saved_searches", {});
    assert.deepEqual(out, SAMPLE_RESULT);
  });
});

/* ------------------------------------------------------------------ */

describe("upstream failures surface as venturejobs error text", () => {
  it("a JSON-RPC error on tools/call becomes an isError venturejobs error", async () => {
    const upstream = makeUpstream({
      callError: { code: -32602, message: "bad arguments" },
    });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("get_job", { job: "x" });
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "venturejobs error: bad arguments");
  });

  it("a JSON-RPC error on initialize becomes an isError venturejobs error", async () => {
    const upstream = makeUpstream({
      initError: { code: -32000, message: "init refused" },
    });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("get_account", {});
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "venturejobs error: init refused");
    assert.equal(upstream.calls.length, 1);
  });

  it("a non-2xx status on tools/call becomes an HTTP venturejobs error", async () => {
    const upstream = makeUpstream({ callStatus: 503, callBodyText: "down" });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("get_account", {});
    assert.equal(out.isError, true);
    assert.match(firstText(out), /^venturejobs error: HTTP 503/);
  });

  it("a non-2xx status on initialize becomes an HTTP venturejobs error", async () => {
    const upstream = makeUpstream({ initStatus: 500, initBodyText: "boom" });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("get_account", {});
    assert.equal(out.isError, true);
    assert.match(firstText(out), /^venturejobs error: HTTP 500/);
  });

  it("an unparseable call body becomes a malformed-response error", async () => {
    const upstream = makeUpstream({ callBodyText: "not json at all" });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("get_account", {});
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "venturejobs error: malformed response");
  });

  it("a reply with no result becomes a malformed-response error", async () => {
    const upstream = makeUpstream({
      callBodyText: JSON.stringify({ jsonrpc: "2.0", id: 2 }),
    });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("get_account", {});
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "venturejobs error: malformed response");
  });

  it("a fetch throw on tools/call becomes a request-failed error", async () => {
    const upstream = makeUpstream({ throwOn: "tools/call" });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("get_account", {});
    assert.equal(out.isError, true);
    assert.match(firstText(out), /^venturejobs error: request failed: socket hang up/);
  });

  it("a fetch throw on initialize becomes a venturejobs error", async () => {
    const upstream = makeUpstream({ throwOn: "initialize" });
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await c.callTool("get_account", {});
    assert.equal(out.isError, true);
    assert.match(firstText(out), /^venturejobs error: socket hang up/);
  });

  it("a hanging call times out into a venturejobs error", async () => {
    const upstream = makeUpstream({ hangOnCall: true });
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: {},
      timeoutMs: 25,
    });
    const out = await c.callTool("get_account", {});
    assert.equal(out.isError, true);
    assert.match(firstText(out), /^venturejobs error: request failed:/);
  });
});

/* ------------------------------------------------------------------ */

describe("parseRpcBody", () => {
  it("parses a plain JSON body", () => {
    const msg = parseRpcBody('{"jsonrpc":"2.0","id":1,"result":{}}', 1);
    assert.deepEqual(msg, { jsonrpc: "2.0", id: 1, result: {} });
  });

  it("parses an SSE body and picks the matching id", () => {
    const body = [
      'data: {"jsonrpc":"2.0","id":1,"result":{"a":1}}',
      "",
      'data: {"jsonrpc":"2.0","id":2,"result":{"b":2}}',
      "",
    ].join("\n");
    const msg = parseRpcBody(body, 2);
    assert.deepEqual(msg?.result, { b: 2 });
  });

  it("ignores the SSE [DONE] marker", () => {
    const msg = parseRpcBody('data: {"jsonrpc":"2.0","id":3}\n\ndata: [DONE]\n', 3);
    assert.equal(msg?.id, 3);
  });

  it("returns null for an empty body", () => {
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("   "), null);
  });

  it("returns null for a body with no JSON payload", () => {
    assert.equal(parseRpcBody("hello world"), null);
  });
});

/* ------------------------------------------------------------------ */

describe("MCP layer validation", () => {
  it("rejects an unknown tool with MethodNotFound before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "not_a_tool", {}),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.MethodNotFound,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects array arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "search_jobs", ["nope"]),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects string arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "get_job", "job=x"),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("forwards a valid search_jobs call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, "search_jobs", { query: "designer" });
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, { query: "designer" });
  });

  it("forwards a valid delete_saved_search call through the MCP layer", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, "delete_saved_search", { id: "s1" });
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "delete_saved_search");
  });

  it("treats omitted arguments as an empty object", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, "get_account", undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, {});
  });
});

/* ------------------------------------------------------------------ */

describe("CLI", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

  function runCli(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  }

  it("--version prints 0.1.0 and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
    assert.equal(res.stdout.trim(), VERSION);
  });

  it("-v prints 0.1.0 and exits 0", () => {
    const res = runCli(["-v"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("an unknown command prints usage on stderr and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a non-JSON argument exits 2", () => {
    const res = runCli(["get_job", "not json"]);
    assert.equal(res.status, 2);
  });

  it("a JSON array argument exits 2", () => {
    const res = runCli(["get_job", "[]"]);
    assert.equal(res.status, 2);
  });

  it("extra arguments after mcp exit 2", () => {
    const res = runCli(["mcp", "extra"]);
    assert.equal(res.status, 2);
  });
});
