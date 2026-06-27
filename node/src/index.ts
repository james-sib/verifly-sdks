/**
 * Official TypeScript/Node SDK for the Verifly email-verification API.
 *
 * npm package name: `@verifly/sdk`.
 *
 * @example
 * ```ts
 * import { VeriflyClient } from "@verifly/sdk";
 * const client = new VeriflyClient("vf_your_api_key");
 * const r = await client.verify("bill.gates@microsoft.com");
 * console.log(r.result, r.recommendation);
 * ```
 */

export const VERSION = "1.0.0";
const DEFAULT_BASE_URL = "https://verifly.email";
const USER_AGENT = `verifly-sdk-node/${VERSION}`;

/* -------------------------------------------------------------------------- */
/*  Typed request/response models (derived from the live OpenAPI spec)         */
/* -------------------------------------------------------------------------- */

export type VerificationVerdict =
  | "deliverable"
  | "undeliverable"
  | "risky"
  | "unknown";

export type Recommendation = "safe_to_send" | "risky" | "do_not_send";

export type PackageId =
  | "starter"
  | "basic"
  | "pro"
  | "business"
  | "enterprise";

export type CheckoutMethod = "stripe" | "crypto";

export type CryptoCurrency = "BTC" | "ETH" | "LTC" | "USDT" | "USDC";

export interface Credits {
  /** Credits charged by this request. */
  used: number;
  /** Credits left on the account. */
  remaining: number;
}

export interface VerificationDetails {
  syntax_valid: boolean;
  domain_exists: boolean;
  mx_records: boolean;
  smtp_valid: boolean;
  is_disposable: boolean;
  is_role_account: boolean;
  is_catch_all: boolean;
  is_free_provider: boolean;
  /** Mail provider / domain. */
  provider: string;
}

export interface VerificationResult {
  success: boolean;
  /** Normalized (lowercased/trimmed) email. */
  email: string;
  /** Present only when the input differed from the normalized email. */
  email_original?: string;
  is_valid: boolean | null;
  result: VerificationVerdict;
  /** Human-readable explanation of the verdict. */
  reason: string;
  details: VerificationDetails;
  recommendation: Recommendation;
  /** True if this verification consumed a credit. */
  credits_charged: boolean;
  /** Did-you-mean suggestion for likely typos (e.g. "user@gmail.com"). */
  did_you_mean?: string | null;
  credits: Credits;
}

export interface BatchResultItem extends VerificationResult {}

export interface BatchVerificationResult {
  success: boolean;
  results: BatchResultItem[];
  [key: string]: unknown;
}

export interface BulkJobResult {
  success: boolean;
  [key: string]: unknown;
}

export interface JobSummary {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  [key: string]: unknown;
}

export interface Job extends JobSummary {}

export interface JobListResult {
  success: boolean;
  jobs: JobSummary[];
  [key: string]: unknown;
}

export interface JobResults {
  success: boolean;
  [key: string]: unknown;
}

export interface CleanResult {
  success: boolean;
  [key: string]: unknown;
}

export interface ExtractResult {
  success: boolean;
  [key: string]: unknown;
}

export interface AccountResult {
  success: boolean;
  [key: string]: unknown;
}

export interface CreditsResult {
  success: boolean;
  [key: string]: unknown;
}

export interface UsageResult {
  success: boolean;
  [key: string]: unknown;
}

export interface BillingPackage {
  id: PackageId;
  name: string;
  credits: number;
  /** Price in USD dollars. */
  price: number;
  currency: "USD";
  /** Computed USD price per 1000 credits. */
  per_1k_credits?: string;
}

export interface PackagesResult {
  success: boolean;
  packages: BillingPackage[];
}

export interface HistoryResult {
  success: boolean;
  [key: string]: unknown;
}

export interface CheckoutResult {
  success: boolean;
  [key: string]: unknown;
}

export interface RegisterResult {
  success: boolean;
  message: string;
  account: { id: string; email: string; credits: number };
  /** Full key shown only once. Null if key generation failed. */
  api_key: { key: string; prefix: string; warning: string } | null;
}

export interface BatchOptions {
  deduplicate?: boolean;
  exclude_public_domains?: boolean;
  exclude_role_accounts?: boolean;
  domain_blacklist?: string[];
  pattern_blacklist?: string[];
}

export interface SubmitBulkOptions {
  emails?: string[];
  text?: string;
  filename?: string;
  webhook_url?: string;
  /** Passed through as the `Idempotency-Key` header (auto-generated otherwise). */
  idempotencyKey?: string;
}

export interface BuyCreditsOptions {
  method?: CheckoutMethod;
  /** Only for method "crypto": BTC|ETH|LTC|USDT|USDC. */
  currency?: CryptoCurrency;
  /** Passed through as the `Idempotency-Key` header (auto-generated otherwise). */
  idempotencyKey?: string;
}

export interface VeriflyClientOptions {
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Retries on 429/5xx (with backoff, honoring Retry-After). Default 3. */
  maxRetries?: number;
}

/* -------------------------------------------------------------------------- */
/*  Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** Thrown when the API returns an error envelope or the request fails. */
export class VeriflyError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status?: number;
  readonly suggestion?: string;

  constructor(
    code: string,
    message: string,
    requestId?: string,
    status?: number,
    suggestion?: string
  ) {
    super(`[${code}] ${message}`);
    this.name = "VeriflyError";
    this.code = code;
    this.requestId = requestId;
    this.status = status;
    this.suggestion = suggestion;
  }
}

/* -------------------------------------------------------------------------- */
/*  Client                                                                     */
/* -------------------------------------------------------------------------- */

type Json = Record<string, unknown>;

export class VeriflyClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(apiKey?: string, options: VeriflyClientOptions = {}) {
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.maxRetries = options.maxRetries ?? 3;
  }

  /* --------------------------- account lifecycle -------------------------- */

  /**
   * Self-register a new account and receive an API key (100 free credits).
   * The full key is in `result.api_key.key` and is shown exactly once.
   */
  static async register(
    email: string,
    password: string,
    options: VeriflyClientOptions = {}
  ): Promise<RegisterResult> {
    const client = new VeriflyClient(undefined, options);
    return client.request<RegisterResult>(
      "POST",
      "/api/v1/autonomous/register",
      { body: { email, password }, auth: false }
    );
  }

  /* ------------------------------ verification ---------------------------- */

  /** Verify a single email address. */
  async verify(email: string): Promise<VerificationResult> {
    return this.request<VerificationResult>("GET", "/api/v1/verify", {
      query: { email },
    });
  }

  /** Verify up to 100 emails synchronously. */
  async verifyBatch(
    emails: string[],
    options: BatchOptions = {}
  ): Promise<BatchVerificationResult> {
    const opts: BatchOptions = { deduplicate: true, ...options };
    return this.request<BatchVerificationResult>("POST", "/api/v1/verify/batch", {
      body: { emails, options: opts },
    });
  }

  /**
   * Create an asynchronous bulk verification job. Provide either `emails`
   * (up to 1,000,000) or raw `text`/CSV. Poll with {@link job} and fetch
   * output with {@link jobResults}.
   */
  async submitBulk(options: SubmitBulkOptions): Promise<BulkJobResult> {
    if (options.emails === undefined && options.text === undefined) {
      throw new Error("submitBulk requires either 'emails' or 'text'");
    }
    const body: Json = {};
    if (options.emails !== undefined) body.emails = options.emails;
    if (options.text !== undefined) body.text = options.text;
    if (options.filename !== undefined) body.filename = options.filename;
    if (options.webhook_url !== undefined) body.webhook_url = options.webhook_url;
    return this.request<BulkJobResult>("POST", "/api/v1/verify/bulk", {
      body,
      idempotencyKey: options.idempotencyKey ?? randomId(),
    });
  }

  /* ------------------------------- hygiene -------------------------------- */

  /** Clean and filter an email list. Does not verify or consume credits. */
  async clean(emails: string[], options?: Json): Promise<CleanResult> {
    const body: Json = { emails };
    if (options !== undefined) body.options = options;
    return this.request<CleanResult>("POST", "/api/v1/clean", { body });
  }

  /** Extract email addresses from arbitrary text or CSV. */
  async extract(
    text: string,
    options: { deduplicate?: boolean; lowercase?: boolean } = {}
  ): Promise<ExtractResult> {
    return this.request<ExtractResult>("POST", "/api/v1/extract", {
      body: {
        text,
        options: { deduplicate: true, lowercase: true, ...options },
      },
    });
  }

  /* -------------------------------- jobs ---------------------------------- */

  /** List bulk verification jobs (optionally filtered). */
  async jobs(params: {
    status?: "pending" | "processing" | "completed" | "failed";
    limit?: number;
    offset?: number;
  } = {}): Promise<JobListResult> {
    return this.request<JobListResult>("GET", "/api/v1/jobs", {
      query: params as Json,
    });
  }

  /** Get the status of a single bulk job. */
  async job(jobId: string): Promise<Job> {
    return this.request<Job>("GET", `/api/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  /** Get the per-email results of a completed bulk job. */
  async jobResults(jobId: string): Promise<JobResults> {
    return this.request<JobResults>(
      "GET",
      `/api/v1/jobs/${encodeURIComponent(jobId)}/results`
    );
  }

  /* ------------------------- account / credits / usage -------------------- */

  /** Get the account profile and credit summary. */
  async account(): Promise<AccountResult> {
    return this.request<AccountResult>("GET", "/api/v1/account");
  }

  /** Get the current credit balance. */
  async credits(): Promise<CreditsResult> {
    return this.request<CreditsResult>("GET", "/api/v1/credits");
  }

  /** Get an API usage summary. */
  async usage(params: { period?: "day" | "week" | "month"; limit?: number } = {}): Promise<UsageResult> {
    return this.request<UsageResult>("GET", "/api/v1/usage", {
      query: params as Json,
    });
  }

  /* ------------------------------- billing -------------------------------- */

  /** List the available credit packages and prices. */
  async packages(): Promise<PackagesResult> {
    return this.request<PackagesResult>("GET", "/api/v1/billing", {
      query: { action: "packages" },
    });
  }

  /** List the account's payment history. */
  async paymentHistory(): Promise<HistoryResult> {
    return this.request<HistoryResult>("GET", "/api/v1/billing", {
      query: { action: "history" },
    });
  }

  /**
   * Create a checkout to buy a credit package (Stripe by default, or crypto).
   * An `Idempotency-Key` is sent automatically so retries never double-charge.
   */
  async buyCredits(
    packageId: PackageId,
    options: BuyCreditsOptions = {}
  ): Promise<CheckoutResult> {
    const body: Json = {
      package_id: packageId,
      method: options.method ?? "stripe",
    };
    if (options.currency !== undefined) body.currency = options.currency;
    return this.request<CheckoutResult>("POST", "/api/v1/billing", {
      body,
      idempotencyKey: options.idempotencyKey ?? randomId(),
    });
  }

  /* ----------------------------- HTTP plumbing ---------------------------- */

  private async request<T>(
    method: string,
    path: string,
    opts: {
      query?: Json;
      body?: Json;
      auth?: boolean;
      idempotencyKey?: string;
    } = {}
  ): Promise<T> {
    const auth = opts.auth !== false;
    let url = this.baseUrl + path;
    if (opts.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) qs.append(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    if (auth) {
      if (!this.apiKey) {
        throw new VeriflyError(
          "missing_api_key",
          "An API key is required for this call. Pass it to new VeriflyClient(apiKey)."
        );
      }
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    let bodyStr: string | undefined;
    if (opts.body !== undefined) {
      bodyStr = JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
    }

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt++;
      let res: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        res = await fetch(url, {
          method,
          headers,
          body: bodyStr,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (attempt <= this.maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        const reason = err instanceof Error ? err.message : String(err);
        throw new VeriflyError("http_error", `Network error contacting Verifly: ${reason}`);
      }
      clearTimeout(timer);

      const requestId = res.headers.get("x-request-id") ?? undefined;
      const text = await res.text();
      let payload: unknown = undefined;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = undefined;
        }
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt <= this.maxRetries) {
          const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
          await sleep(retryAfter ?? backoff(attempt));
          continue;
        }
      }

      const isErrorEnvelope =
        payload != null &&
        typeof payload === "object" &&
        (payload as Json).success === false;

      if (res.status >= 400 || isErrorEnvelope) {
        throwForEnvelope(payload, res.status, requestId);
      }

      if (payload == null || typeof payload !== "object") {
        throw new VeriflyError(
          "invalid_response",
          "Expected a JSON object response from Verifly.",
          requestId,
          res.status
        );
      }
      return payload as T;
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function throwForEnvelope(
  payload: unknown,
  status: number,
  requestId?: string
): never {
  if (
    payload != null &&
    typeof payload === "object" &&
    typeof (payload as Json).error === "object" &&
    (payload as Json).error !== null
  ) {
    const err = (payload as { error: Json }).error;
    throw new VeriflyError(
      String(err.code ?? "unknown_error"),
      String(err.message ?? "Unknown error"),
      requestId,
      status,
      err.suggestion ? String(err.suggestion) : undefined
    );
  }
  throw new VeriflyError(
    "http_error",
    `Request failed with HTTP ${status}`,
    requestId,
    status
  );
}

function backoff(attempt: number): number {
  return Math.min(2 ** (attempt - 1), 30) * 1000;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n * 1000 : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export default VeriflyClient;
