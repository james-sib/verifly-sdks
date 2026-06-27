# verifly-email-sdk (Python)

Official Python SDK for the [Verifly](https://verifly.email) email-verification API.

> **Package naming.** The published PyPI package name will be **`verifly-email-sdk`**
> (import as **`verifly_sdk`**). It is **not on PyPI yet** — install from this repo
> with the command below.
> Do **not** install `verifly-sdk` or `verifly` on PyPI — those belong to an
> **unrelated 2FA company** (verifly.net), not this project.

- Zero dependencies (pure Python standard library).
- Fully typed, with docstrings on every method.
- Built-in retry with backoff on `429` / `5xx` (honors `Retry-After`).
- Automatic `Idempotency-Key` for `buy_credits` and `submit_bulk`.
- Typed `VeriflyError(code, message, request_id)` on API error envelopes.

## Install

```bash
# Install from this repo (not on PyPI yet):
pip install "git+https://github.com/james-sib/verifly-sdks.git#subdirectory=python"

# or from a local checkout:
pip install /path/to/verifly-sdks/python
```

## Quick start

```python
from verifly_sdk import VeriflyClient, VeriflyError

client = VeriflyClient("vf_your_api_key")   # base_url defaults to https://verifly.email

try:
    r = client.verify("bill.gates@microsoft.com")
    print(r["result"])           # deliverable | undeliverable | risky | unknown
    print(r["recommendation"])   # safe_to_send | risky | do_not_send
    print(r["credits"])          # {"used": 1, "remaining": 99}
except VeriflyError as e:
    print(e.code, e.message, e.request_id)
```

## Authentication

Every call (except `register`) authenticates with your `vf_` key, sent as
`Authorization: Bearer <api_key>`.

```python
client = VeriflyClient(api_key="vf_...", base_url="https://verifly.email")
```

## Create an account programmatically

```python
res = VeriflyClient.register("you@example.com", "a-strong-password")
api_key = res["api_key"]["key"]   # shown ONCE — store it now
client = VeriflyClient(api_key)
```

## Methods

| Method | Description |
| --- | --- |
| `verify(email)` | Verify a single address. |
| `verify_batch(emails, deduplicate=True, ...)` | Verify up to 100 addresses synchronously. |
| `clean(emails, options=None)` | Clean/filter a list (no verification, no credits). |
| `extract(text, deduplicate=True, lowercase=True)` | Pull email addresses out of text/CSV. |
| `submit_bulk(emails=None, text=None, webhook_url=None, ...)` | Create an async bulk job (up to 1M). |
| `jobs(status=None, limit=None, offset=None)` | List bulk jobs. |
| `job(job_id)` | Get a bulk job's status. |
| `job_results(job_id)` | Get a completed job's per-email results. |
| `account()` | Account profile + credit summary. |
| `credits()` | Current credit balance. |
| `usage(period=None, limit=None)` | API usage summary (day/week/month). |
| `packages()` | List credit packages and prices. |
| `payment_history()` | List payment history. |
| `buy_credits(package_id, method="stripe", currency=None)` | Create a Stripe/crypto checkout. |
| `VeriflyClient.register(email, password)` *(classmethod)* | Self-register, returns account + API key. |

### Examples

```python
# Batch (<=100), synchronous
batch = client.verify_batch(
    ["a@example.com", "b@example.com"],
    exclude_role_accounts=True,
)
for item in batch["results"]:
    print(item["email"], item["result"])

# List hygiene without spending credits
print(client.clean(["A@Example.com ", "a@example.com", "bad"])["..."])
print(client.extract("contact us at sales@acme.io or ceo@acme.io"))

# Async bulk + polling
job = client.submit_bulk(emails=[...], webhook_url="https://you/webhook")
status = client.job(job["job_id"] if "job_id" in job else job["job"]["id"])
results = client.job_results(job_id)

# Account / billing
print(client.credits())
print(client.packages())
checkout = client.buy_credits("pro", method="stripe")
checkout = client.buy_credits("pro", method="crypto", currency="USDT")
```

## Errors

API error envelopes (`{"success": false, "error": {...}}`) and non-2xx
responses raise `VeriflyError`:

```python
try:
    client.verify("nope")
except VeriflyError as e:
    e.code         # e.g. "invalid_email", "insufficient_credits", "rate_limit_exceeded"
    e.message
    e.request_id   # from the x-request-id response header
    e.status       # HTTP status
    e.suggestion   # optional remediation hint
```

## Retries & idempotency

- `429` and `5xx` responses are retried (default 3 times) with exponential
  backoff, honoring the `Retry-After` header. Configure via
  `VeriflyClient(..., max_retries=N, timeout=seconds)`.
- `buy_credits` and `submit_bulk` send an `Idempotency-Key` header. One is
  auto-generated per call; pass your own with `idempotency_key=...` to make a
  specific retry safe end-to-end.

## License

MIT
