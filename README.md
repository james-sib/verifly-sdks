# Verifly SDKs

Official client SDKs for the [Verifly](https://verifly.email) email-verification API.

- **Python** — [`python/`](./python) · published package name will be `verifly-email-sdk`
- **Node / TypeScript** — [`node/`](./node) · published package name will be `verifly-email-sdk`

Both are zero-dependency, typed, with retry/backoff, `Idempotency-Key` support, and typed errors.
Get an API key with no human: `POST https://verifly.email/api/v1/autonomous/register`.

> **Not published to npm/PyPI yet — install from this repo (see below).**
> The published name for both languages will be **`verifly-email-sdk`**.
> Do **not** install `verifly-sdk` (PyPI/npm) or `@verifly/sdk` (npm) — those are an
> **unrelated company** (a 2FA product at verifly.net), not this project.

## Install (from this repo)

```bash
# Python
pip install "git+https://github.com/james-sib/verifly-sdks.git#subdirectory=python"

# Node / TypeScript — clone + local install (package.json lives in node/)
git clone https://github.com/james-sib/verifly-sdks.git
cd verifly-sdks/node && npm install && npm run build
# then reference it locally, e.g.  npm install /path/to/verifly-sdks/node
```
