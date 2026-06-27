# @verifly/sdk (Node / TypeScript)

Official TypeScript/Node SDK for the [Verifly](https://verifly.email)
email-verification API.

> **Package naming.** The scoped name **`@verifly/sdk`** is the official
> package. The unscoped `verifly` name on npm is **not** maintained by this
> project — always install the scoped `@verifly/sdk`. (On PyPI, the Python SDK
> is `verifly-sdk`, because plain `verifly` there is an unrelated 2FA company.)

- Zero runtime dependencies — uses the built-in `fetch` (Node 18+).
- Fully typed request/response interfaces derived from the live OpenAPI spec.
- Built-in retry with backoff on `429` / `5xx` (honors `Retry-After`).
- Automatic `Idempotency-Key` for `buyCredits` and `submitBulk`.
- Typed `VeriflyError` (`code`, `message`, `requestId`) on API errors.

## Install

```bash
npm install @verifly/sdk        # once published
```

## Quick start

```ts
import { VeriflyClient, VeriflyError } from "@verifly/sdk";

const client = new VeriflyClient("vf_your_api_key"); // baseUrl defaults to https://verifly.email

try {
  const r = await client.verify("bill.gates@microsoft.com");
  console.log(r.result);         // "deliverable" | "undeliverable" | "risky" | "unknown"
  console.log(r.recommendation); // "safe_to_send" | "risky" | "do_not_send"
  console.log(r.credits);        // { used: 1, remaining: 99 }
} catch (e) {
  if (e instanceof VeriflyError) {
    console.error(e.code, e.message, e.requestId);
  }
}
```

CommonJS works too:

```js
const { VeriflyClient } = require("@verifly/sdk");
```

## Authentication

Every call (except `register`) authenticates with your `vf_` key, sent as
`Authorization: Bearer <api_key>`.

```ts
const client = new VeriflyClient("vf_...", { baseUrl: "https://verifly.email" });
```

## Create an account programmatically

```ts
const res = await VeriflyClient.register("you@example.com", "a-strong-password");
const apiKey = res.api_key!.key; // shown ONCE — store it now
const client = new VeriflyClient(apiKey);
```

## Methods

| Method | Description |
| --- | --- |
| `verify(email)` | Verify a single address → `VerificationResult`. |
| `verifyBatch(emails, options?)` | Verify up to 100 addresses synchronously. |
| `clean(emails, options?)` | Clean/filter a list (no verification, no credits). |
| `extract(text, options?)` | Pull email addresses out of text/CSV. |
| `submitBulk({ emails?, text?, webhook_url?, ... })` | Create an async bulk job (up to 1M). |
| `jobs({ status?, limit?, offset? })` | List bulk jobs. |
| `job(jobId)` | Get a bulk job's status. |
| `jobResults(jobId)` | Get a completed job's per-email results. |
| `account()` | Account profile + credit summary. |
| `credits()` | Current credit balance. |
| `usage({ period?, limit? })` | API usage summary (day/week/month). |
| `packages()` | List credit packages and prices. |
| `paymentHistory()` | List payment history. |
| `buyCredits(packageId, { method?, currency? })` | Create a Stripe/crypto checkout. |
| `VeriflyClient.register(email, password)` *(static)* | Self-register, returns account + API key. |

### Verdict shape (`VerificationResult`)

```ts
interface VerificationResult {
  success: boolean;
  email: string;
  is_valid: boolean | null;
  result: "deliverable" | "undeliverable" | "risky" | "unknown";
  reason: string;
  details: {
    syntax_valid: boolean; domain_exists: boolean; mx_records: boolean;
    smtp_valid: boolean; is_disposable: boolean; is_role_account: boolean;
    is_catch_all: boolean; is_free_provider: boolean; provider: string;
  };
  recommendation: "safe_to_send" | "risky" | "do_not_send";
  confidence?: number;
  did_you_mean?: string | null;
  credits: { used: number; remaining: number };
}
```

### Examples

```ts
// Batch (<=100), synchronous
const batch = await client.verifyBatch(["a@example.com", "b@example.com"], {
  exclude_role_accounts: true,
});
for (const item of batch.results) console.log(item.email, item.result);

// List hygiene without spending credits
await client.clean(["A@Example.com ", "a@example.com", "bad"]);
await client.extract("contact us at sales@acme.io or ceo@acme.io");

// Async bulk + polling
const created = await client.submitBulk({ emails, webhook_url: "https://you/webhook" });
const status = await client.job(jobId);
const results = await client.jobResults(jobId);

// Account / billing
await client.credits();
await client.packages();
await client.buyCredits("pro");                              // Stripe
await client.buyCredits("pro", { method: "crypto", currency: "USDT" });
```

## Errors

API error envelopes (`{ success: false, error: {...} }`) and non-2xx responses
throw `VeriflyError`:

```ts
try {
  await client.verify("nope");
} catch (e) {
  if (e instanceof VeriflyError) {
    e.code;       // "invalid_email" | "insufficient_credits" | "rate_limit_exceeded" | ...
    e.message;
    e.requestId;  // from the x-request-id response header
    e.status;     // HTTP status
    e.suggestion; // optional remediation hint
  }
}
```

## Retries & idempotency

- `429` and `5xx` are retried (default 3×) with exponential backoff, honoring
  `Retry-After`. Configure via `new VeriflyClient(key, { maxRetries, timeoutMs })`.
- `buyCredits` and `submitBulk` send an `Idempotency-Key` header (auto-generated
  per call; override with `{ idempotencyKey }`).

## Build

```bash
npm install
npm run build   # emits dist/index.js + dist/index.d.ts
```

## License

MIT
