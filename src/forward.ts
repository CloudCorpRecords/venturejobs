/**
 * venturejobs core: a forwarding client for the hosted
 * jobs MCP server covering startups that raised venture
 * money recently.
 *
 * Nothing is searched or stored locally. tools/list is
 * answered from the literal definitions below, taken
 * verbatim from a live capture of the upstream server
 * (name, title, description and inputSchema exactly as
 * captured). A tools/call travels upstream over a
 * streamable-HTTP JSON-RPC session: an initialize POST,
 * a notifications/initialized POST, then the tools/call
 * POST, carrying the Mcp-Session-Id response header on
 * later requests when the upstream issues one. The
 * session opens lazily on the first forwarded call and
 * is reused for the client's life.
 *
 * The endpoint is pinned to https://justbacked.com/api/mcp
 * and may be replaced with the JUSTBACKED_MCP_URL
 * environment variable (that override is a labelled
 * reconstruction). When JUSTBACKED_API_KEY is set, every
 * upstream request carries an
 * `Authorization: Bearer <key>` header (header name
 * pinned by the registry record's own remote
 * declaration; the Bearer form and forwarding the key
 * from this env var are labelled reconstructions, as the
 * record pins no package env name and the capture was
 * taken keyless). When it is unset, no key header goes
 * out.
 *
 * A successful upstream result is returned exactly as
 * received, isError flag and extra fields included.
 * Failures — an upstream JSON-RPC error, a non-2xx
 * status, a body that cannot be parsed, or a fetch that
 * throws or times out — become an isError result whose
 * text begins with `venturejobs error:` (that rendering
 * is a labelled reconstruction). Replies may be plain
 * JSON or SSE (`data:` lines); the JSON-RPC message
 * whose id matches the request wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://justbacked.com/api/mcp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/justbacked-tools-original.json;         */
/* generated programmatically by parsing and re-serialising the        */
/* fixture JSON, never retyped)                                        */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "search_jobs",
    "title": "Search startup jobs",
    "description": "Search open roles at startups that raised venture money in the last six months. Same filters as the justbacked.com board. Members see roles the day they are posted. Returns jobs with title, company, location, pay, latest round, investors and apply link, plus total matches and a board_url to share.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Keywords matched against job title, company and department, e.g. \"product designer\" or \"founding engineer\". Supports quotes and -exclusions."
        },
        "search_descriptions": {
          "type": "boolean",
          "description": "Also match query inside full job descriptions (broader, noisier)."
        },
        "cities": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Metro areas: sf (SF Bay Area), nyc (New York), la (Los Angeles), bos (Boston), sea (Seattle), aus (Austin), den (Denver / Boulder), chi (Chicago), dc (Washington DC), mia (Miami), atl (Atlanta), sd (San Diego), lon (London), par (Paris), ber (Berlin), muc (Munich), tor (Toronto), sgp (Singapore), blr (Bengaluru), tlv (Tel Aviv), sto (Stockholm), ams (Amsterdam). Names work too."
        },
        "location": {
          "type": "string",
          "description": "Free-text location match for places outside the metro list, e.g. \"Portland\"."
        },
        "countries": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Country codes: us, gb, de, ca, fr, in, sg, au, es, nl, il, se, ch, ie, ae, jp."
        },
        "work_modes": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "remote",
              "hybrid",
              "onsite"
            ]
          },
          "description": "remote, hybrid, onsite."
        },
        "functions": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "engineering",
              "product",
              "design",
              "data",
              "sales",
              "marketing",
              "customer",
              "operations",
              "finance",
              "people",
              "legal",
              "hardware",
              "science",
              "clinical"
            ]
          },
          "description": "Job function: engineering (Engineering), product (Product), design (Design), data (Data & ML), sales (Sales & BD), marketing (Marketing), customer (Customer), operations (Operations), finance (Finance), people (People), legal (Legal), hardware (Hardware), science (Science), clinical (Clinical)."
        },
        "seniority": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "intern",
              "entry",
              "mid",
              "senior",
              "staff",
              "manager",
              "director",
              "exec"
            ]
          },
          "description": "Level: intern, entry, mid, senior, staff, manager, director, exec."
        },
        "stages": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "preseed",
              "seed",
              "a",
              "b",
              "c",
              "growth",
              "venture"
            ]
          },
          "description": "Company's latest round: preseed (Pre-seed), seed (Seed), a (Series A), b (Series B), c (Series C), growth (Series D+), venture (Venture (series unknown))."
        },
        "raised_within_days": {
          "type": "number",
          "description": "Only companies whose latest round is at most this many days old (e.g. 30)."
        },
        "min_raise_usd": {
          "type": "number",
          "description": "Minimum size of the latest round in USD, e.g. 20000000."
        },
        "min_pay_usd": {
          "type": "number",
          "description": "Minimum published annual pay in USD (roles without published pay are excluded)."
        },
        "has_pay": {
          "type": "boolean",
          "description": "Only roles that publish a salary range."
        },
        "company_sizes": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "1-10",
              "11-50",
              "51-250",
              "251-1000",
              "1000+"
            ]
          },
          "description": "Headcount bands: 1-10, 11-50, 51-250, 251-1000, 1000+."
        },
        "industries": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Industry keywords, e.g. [\"fintech\", \"climate\"]."
        },
        "investors": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Investor names (any of), e.g. [\"Sequoia\", \"a16z\"]."
        },
        "posted_within_hours": {
          "type": "number",
          "description": "Only roles posted in the last N hours (24 or 48 shows the newest roles)."
        },
        "hiring_fast": {
          "type": "boolean",
          "description": "Only companies that added 10+ roles in the last 30 days."
        },
        "employment": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "fulltime",
              "parttime",
              "contract",
              "intern"
            ]
          },
          "description": "fulltime, parttime, contract, intern."
        },
        "exclude_title_words": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Drop roles whose title contains any of these words, e.g. [\"senior\", \"manager\"]."
        },
        "list_id": {
          "type": "string",
          "description": "Only companies on one of the user's lists (id from list_lists)."
        },
        "include_non_venture": {
          "type": "boolean",
          "description": "Include debt, grants, PE and corporate rounds (default: venture rounds only)."
        },
        "sort": {
          "type": "string",
          "enum": [
            "new",
            "relevance",
            "raised",
            "amount"
          ],
          "description": "new (default), relevance (with query), raised (most recent round first), amount (biggest round first)."
        },
        "limit": {
          "type": "number",
          "description": "1-50, default 20."
        },
        "offset": {
          "type": "number",
          "description": "For paging."
        }
      }
    }
  },
  {
    "name": "get_job",
    "title": "Get job detail",
    "description": "Full detail for one role: description, pay, the company's latest round and investors, hiring velocity, apply URL, which hiring system (ATS) it uses, and whether it is already in the user's tracker.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "job": {
          "type": "string",
          "description": "The job value from search_jobs (a slug), or the role's justbacked.com/jobs URL."
        }
      },
      "required": [
        "job"
      ]
    }
  },
  {
    "name": "get_application_form",
    "title": "Get application questions",
    "description": "The role's application questions (labels, types, required, options) read from the company's public Greenhouse, Lever or Ashby job board, so you can draft answers for the user to review. Read-only: it never submits anything. The user applies at apply_url.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "job": {
          "type": "string",
          "description": "The job value from search_jobs (a slug), or the role's justbacked.com/jobs URL."
        }
      },
      "required": [
        "job"
      ]
    }
  },
  {
    "name": "get_company",
    "title": "Research a startup",
    "description": "A startup's profile: latest round, amount, date, lead investors, headcount, HQ, hiring velocity by function, and every open role.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "company": {
          "type": "string",
          "description": "company_slug from search_jobs, or the company name."
        }
      },
      "required": [
        "company"
      ]
    }
  },
  {
    "name": "track_application",
    "title": "Add to application tracker",
    "description": "Add a role to the user's JustBacked tracker (shown at justbacked.com/saved) or update its status. Statuses: saved, applied, interviewing, offer, rejected, withdrawn, archived. Use \"saved\" for roles the user is considering; use \"applied\" only after the user confirms they submitted. For a role found elsewhere, pass title + company + apply_url instead of job.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "job": {
          "type": "string",
          "description": "The job value from search_jobs (a slug), or the role's justbacked.com/jobs URL."
        },
        "status": {
          "type": "string",
          "enum": [
            "saved",
            "applied",
            "interviewing",
            "offer",
            "rejected",
            "withdrawn",
            "archived"
          ],
          "description": "Default applied."
        },
        "notes": {
          "type": "string",
          "description": "Free-text notes (replaces existing notes)."
        },
        "applied_at": {
          "type": "string",
          "description": "Date applied, YYYY-MM-DD. Defaults to today when status moves past saved."
        },
        "title": {
          "description": "Role title, for a role found elsewhere (pass with company and apply_url instead of job).",
          "type": "string"
        },
        "company": {
          "description": "Company name, for a role found elsewhere.",
          "type": "string"
        },
        "apply_url": {
          "description": "The role's application URL, for a role found elsewhere.",
          "type": "string"
        }
      }
    }
  },
  {
    "name": "list_applications",
    "title": "List tracked applications",
    "description": "The user's application tracker: every saved or applied role with status, applied date and notes, plus counts by status.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "saved",
            "applied",
            "interviewing",
            "offer",
            "rejected",
            "withdrawn",
            "archived"
          ],
          "description": "Only this status."
        },
        "limit": {
          "type": "number",
          "description": "Default 100, max 200."
        }
      }
    }
  },
  {
    "name": "update_application",
    "title": "Update a tracked application",
    "description": "Change a tracked role's status (e.g. interviewing, offer, rejected, withdrawn), replace its notes, or append a dated note.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "job": {
          "type": "string",
          "description": "The job value from list_applications."
        },
        "status": {
          "description": "New status for the tracked role.",
          "type": "string",
          "enum": [
            "saved",
            "applied",
            "interviewing",
            "offer",
            "rejected",
            "withdrawn",
            "archived"
          ]
        },
        "notes": {
          "description": "Free-text notes (replaces existing notes).",
          "type": "string"
        },
        "append_note": {
          "type": "string",
          "description": "Adds a dated line to the notes."
        },
        "applied_at": {
          "type": "string",
          "description": "YYYY-MM-DD"
        }
      },
      "required": [
        "job"
      ]
    }
  },
  {
    "name": "list_lists",
    "title": "List company lists",
    "description": "The user's company lists (target companies) with each company's open roles and new roles this week. A list id also works as list_id in search_jobs.",
    "inputSchema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "add_to_list",
    "title": "Add company to a list",
    "description": "Add a startup to one of the user's lists. Pass list_id, or list_name (an existing list's name, or a new list to create). Lists with alerts on email the user when a company posts a role or raises.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "company": {
          "type": "string",
          "description": "company_slug or name."
        },
        "list_id": {
          "description": "The list's id (pass this, or list_name).",
          "type": "string"
        },
        "list_name": {
          "description": "An existing list's name, or a new list to create.",
          "type": "string"
        }
      },
      "required": [
        "company"
      ]
    }
  },
  {
    "name": "remove_from_list",
    "title": "Remove company from a list",
    "description": "Remove a startup from one of the user's lists.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "company": {
          "description": "company_slug or name.",
          "type": "string"
        },
        "list_id": {
          "description": "The list's id.",
          "type": "string"
        }
      },
      "required": [
        "company",
        "list_id"
      ]
    }
  },
  {
    "name": "list_saved_searches",
    "title": "List saved searches",
    "description": "The user's saved searches (email alerts) with their filters and board links.",
    "inputSchema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "save_search",
    "title": "Save a search as an email alert",
    "description": "Save a search with the same filters as search_jobs. JustBacked emails new matching roles instantly (as soon as they reach JustBacked), daily or weekly.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "e.g. \"Series A design, NYC\""
        },
        "alert": {
          "type": "string",
          "enum": [
            "instant",
            "daily",
            "weekly",
            "off"
          ],
          "description": "Default instant: an email as soon as new matches arrive."
        },
        "query": {
          "type": "string",
          "description": "Keywords matched against job title, company and department, e.g. \"product designer\" or \"founding engineer\". Supports quotes and -exclusions."
        },
        "search_descriptions": {
          "type": "boolean",
          "description": "Also match query inside full job descriptions (broader, noisier)."
        },
        "cities": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Metro areas: sf (SF Bay Area), nyc (New York), la (Los Angeles), bos (Boston), sea (Seattle), aus (Austin), den (Denver / Boulder), chi (Chicago), dc (Washington DC), mia (Miami), atl (Atlanta), sd (San Diego), lon (London), par (Paris), ber (Berlin), muc (Munich), tor (Toronto), sgp (Singapore), blr (Bengaluru), tlv (Tel Aviv), sto (Stockholm), ams (Amsterdam). Names work too."
        },
        "location": {
          "type": "string",
          "description": "Free-text location match for places outside the metro list, e.g. \"Portland\"."
        },
        "countries": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Country codes: us, gb, de, ca, fr, in, sg, au, es, nl, il, se, ch, ie, ae, jp."
        },
        "work_modes": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "remote",
              "hybrid",
              "onsite"
            ]
          },
          "description": "remote, hybrid, onsite."
        },
        "functions": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "engineering",
              "product",
              "design",
              "data",
              "sales",
              "marketing",
              "customer",
              "operations",
              "finance",
              "people",
              "legal",
              "hardware",
              "science",
              "clinical"
            ]
          },
          "description": "Job function: engineering (Engineering), product (Product), design (Design), data (Data & ML), sales (Sales & BD), marketing (Marketing), customer (Customer), operations (Operations), finance (Finance), people (People), legal (Legal), hardware (Hardware), science (Science), clinical (Clinical)."
        },
        "seniority": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "intern",
              "entry",
              "mid",
              "senior",
              "staff",
              "manager",
              "director",
              "exec"
            ]
          },
          "description": "Level: intern, entry, mid, senior, staff, manager, director, exec."
        },
        "stages": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "preseed",
              "seed",
              "a",
              "b",
              "c",
              "growth",
              "venture"
            ]
          },
          "description": "Company's latest round: preseed (Pre-seed), seed (Seed), a (Series A), b (Series B), c (Series C), growth (Series D+), venture (Venture (series unknown))."
        },
        "raised_within_days": {
          "type": "number",
          "description": "Only companies whose latest round is at most this many days old (e.g. 30)."
        },
        "min_raise_usd": {
          "type": "number",
          "description": "Minimum size of the latest round in USD, e.g. 20000000."
        },
        "min_pay_usd": {
          "type": "number",
          "description": "Minimum published annual pay in USD (roles without published pay are excluded)."
        },
        "has_pay": {
          "type": "boolean",
          "description": "Only roles that publish a salary range."
        },
        "company_sizes": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "1-10",
              "11-50",
              "51-250",
              "251-1000",
              "1000+"
            ]
          },
          "description": "Headcount bands: 1-10, 11-50, 51-250, 251-1000, 1000+."
        },
        "industries": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Industry keywords, e.g. [\"fintech\", \"climate\"]."
        },
        "investors": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Investor names (any of), e.g. [\"Sequoia\", \"a16z\"]."
        },
        "posted_within_hours": {
          "type": "number",
          "description": "Only roles posted in the last N hours (24 or 48 shows the newest roles)."
        },
        "hiring_fast": {
          "type": "boolean",
          "description": "Only companies that added 10+ roles in the last 30 days."
        },
        "employment": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "fulltime",
              "parttime",
              "contract",
              "intern"
            ]
          },
          "description": "fulltime, parttime, contract, intern."
        },
        "exclude_title_words": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Drop roles whose title contains any of these words, e.g. [\"senior\", \"manager\"]."
        },
        "list_id": {
          "type": "string",
          "description": "Only companies on one of the user's lists (id from list_lists)."
        },
        "include_non_venture": {
          "type": "boolean",
          "description": "Include debt, grants, PE and corporate rounds (default: venture rounds only)."
        }
      }
    }
  },
  {
    "name": "delete_saved_search",
    "title": "Delete a saved search",
    "description": "Delete one of the user's saved searches by id.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The saved search's id (see list_saved_searches).",
          "type": "string"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "get_account",
    "title": "Account",
    "description": "The user's membership, API usage today and tracker/list/search counts.",
    "inputSchema": {
      "type": "object",
      "properties": {}
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` belongs to the captured surface. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `venturejobs error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Read a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * present, otherwise the last parseable message, otherwise
 * null when nothing in the body parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not a JSON payload; skip this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client that holds a single upstream
 * session, opened lazily on first use and reused from
 * then on (for the process lifetime in the MCP server,
 * or for a single invocation in the CLI).
 */
export class VenturejobsClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).JUSTBACKED_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private apiKey(): string | null {
    const raw = (this.deps.env ?? process.env).JUSTBACKED_API_KEY;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.apiKey();
    if (key !== null) headers["Authorization"] = `Bearer ${key}`;
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "venturejobs", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // Nothing needed from the notification response body.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Hand the upstream result back exactly as received.
    return result;
  }
}

/** Build a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): VenturejobsClient {
  return new VenturejobsClient(deps);
}

/** One-shot helper: a fresh client for a single call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new VenturejobsClient(deps).callTool(name, args);
}
