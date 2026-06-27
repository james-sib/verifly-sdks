"""Verifly API client.

Zero third-party dependencies: built on the Python standard library only
(``urllib``), so it installs and runs anywhere with no extra packages.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Dict, List, Optional, Sequence

__version__ = "1.0.0"

DEFAULT_BASE_URL = "https://verifly.email"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 3
_USER_AGENT = f"verifly-sdk-python/{__version__}"

JSON = Dict[str, Any]


class VeriflyError(Exception):
    """Raised when the Verifly API returns an error envelope or the request fails.

    Attributes:
        code: Machine-readable error code (e.g. ``invalid_api_key``,
            ``insufficient_credits``, ``rate_limit_exceeded``). ``http_error``
            for transport-level failures.
        message: Human-readable explanation.
        request_id: Server request id, when provided (from the
            ``x-request-id`` response header).
        status: HTTP status code, when available.
        suggestion: Optional remediation hint from the API.
    """

    def __init__(
        self,
        code: str,
        message: str,
        request_id: Optional[str] = None,
        status: Optional[int] = None,
        suggestion: Optional[str] = None,
    ) -> None:
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message
        self.request_id = request_id
        self.status = status
        self.suggestion = suggestion


class VeriflyClient:
    """Typed client for the Verifly email-verification API.

    Args:
        api_key: Your ``vf_`` API key. Sent as ``Authorization: Bearer <key>``.
            Not required for :meth:`register`.
        base_url: API base URL. Defaults to ``https://verifly.email``.
        timeout: Per-request timeout in seconds.
        max_retries: Number of retries on 429 / 5xx responses (with backoff,
            honoring ``Retry-After``).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries

    # ------------------------------------------------------------------ #
    # Account lifecycle
    # ------------------------------------------------------------------ #
    @classmethod
    def register(
        cls,
        email: str,
        password: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> JSON:
        """Self-register a new account and receive an API key (100 free credits).

        The full API key is shown exactly once, under ``result["api_key"]["key"]``.

        Returns the ``RegisterResult`` envelope: ``{success, message, account,
        api_key}``.
        """
        client = cls(api_key=None, base_url=base_url, timeout=timeout)
        return client._request(
            "POST",
            "/api/v1/autonomous/register",
            body={"email": email, "password": password},
            auth=False,
        )

    # ------------------------------------------------------------------ #
    # Verification
    # ------------------------------------------------------------------ #
    def verify(self, email: str) -> JSON:
        """Verify a single email address.

        Returns a ``VerificationResult``: ``{success, email, is_valid, result
        (deliverable|undeliverable|risky|unknown), reason, details{...},
        recommendation (safe_to_send|risky|do_not_send), credits_charged,
        credits{used,remaining}}``.
        """
        return self._request("GET", "/api/v1/verify", query={"email": email})

    def verify_batch(
        self,
        emails: Sequence[str],
        deduplicate: bool = True,
        exclude_public_domains: bool = False,
        exclude_role_accounts: bool = False,
        domain_blacklist: Optional[Sequence[str]] = None,
        pattern_blacklist: Optional[Sequence[str]] = None,
    ) -> JSON:
        """Verify up to 100 emails synchronously.

        Returns a ``BatchVerificationResult`` with a ``results`` array.
        """
        options: JSON = {
            "deduplicate": deduplicate,
            "exclude_public_domains": exclude_public_domains,
            "exclude_role_accounts": exclude_role_accounts,
        }
        if domain_blacklist is not None:
            options["domain_blacklist"] = list(domain_blacklist)
        if pattern_blacklist is not None:
            options["pattern_blacklist"] = list(pattern_blacklist)
        return self._request(
            "POST",
            "/api/v1/verify/batch",
            body={"emails": list(emails), "options": options},
        )

    def submit_bulk(
        self,
        emails: Optional[Sequence[str]] = None,
        text: Optional[str] = None,
        filename: Optional[str] = None,
        webhook_url: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JSON:
        """Create an asynchronous bulk verification job.

        Provide either ``emails`` (up to 1,000,000) or raw ``text``/CSV to
        extract addresses from. ``webhook_url`` is called when the job
        completes. Returns a ``BulkJobResult`` with the job id; poll with
        :meth:`job` and fetch output with :meth:`job_results`.

        ``idempotency_key`` is passed through as the ``Idempotency-Key`` header;
        if omitted, one is generated automatically so retries are safe.
        """
        if emails is None and text is None:
            raise ValueError("submit_bulk requires either 'emails' or 'text'")
        body: JSON = {}
        if emails is not None:
            body["emails"] = list(emails)
        if text is not None:
            body["text"] = text
        if filename is not None:
            body["filename"] = filename
        if webhook_url is not None:
            body["webhook_url"] = webhook_url
        return self._request(
            "POST",
            "/api/v1/verify/bulk",
            body=body,
            idempotency_key=idempotency_key or str(uuid.uuid4()),
        )

    # ------------------------------------------------------------------ #
    # List hygiene
    # ------------------------------------------------------------------ #
    def clean(
        self,
        emails: Sequence[str],
        options: Optional[JSON] = None,
    ) -> JSON:
        """Clean and filter an email list (dedupe, syntax, role/disposable, etc).

        Does not verify deliverability and does not consume credits. Returns a
        ``CleanResult``. Pass ``options`` to control the cleaning behavior.
        """
        body: JSON = {"emails": list(emails)}
        if options is not None:
            body["options"] = options
        return self._request("POST", "/api/v1/clean", body=body)

    def extract(self, text: str, deduplicate: bool = True, lowercase: bool = True) -> JSON:
        """Extract email addresses from arbitrary text or CSV content.

        Returns an ``ExtractResult`` with the found addresses.
        """
        return self._request(
            "POST",
            "/api/v1/extract",
            body={
                "text": text,
                "options": {"deduplicate": deduplicate, "lowercase": lowercase},
            },
        )

    # ------------------------------------------------------------------ #
    # Jobs
    # ------------------------------------------------------------------ #
    def jobs(
        self,
        status: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> JSON:
        """List bulk verification jobs (optionally filtered by status)."""
        query: JSON = {}
        if status is not None:
            query["status"] = status
        if limit is not None:
            query["limit"] = limit
        if offset is not None:
            query["offset"] = offset
        return self._request("GET", "/api/v1/jobs", query=query or None)

    def job(self, job_id: str) -> JSON:
        """Get the status of a single bulk job."""
        return self._request("GET", f"/api/v1/jobs/{urllib.parse.quote(job_id)}")

    def job_results(self, job_id: str) -> JSON:
        """Get the per-email results of a completed bulk job as JSON."""
        return self._request(
            "GET", f"/api/v1/jobs/{urllib.parse.quote(job_id)}/results"
        )

    # ------------------------------------------------------------------ #
    # Account, credits, usage
    # ------------------------------------------------------------------ #
    def account(self) -> JSON:
        """Get the account profile and credit summary."""
        return self._request("GET", "/api/v1/account")

    def credits(self) -> JSON:
        """Get the current credit balance."""
        return self._request("GET", "/api/v1/credits")

    def usage(self, period: Optional[str] = None, limit: Optional[int] = None) -> JSON:
        """Get an API usage summary. ``period`` is one of day|week|month."""
        query: JSON = {}
        if period is not None:
            query["period"] = period
        if limit is not None:
            query["limit"] = limit
        return self._request("GET", "/api/v1/usage", query=query or None)

    # ------------------------------------------------------------------ #
    # Billing
    # ------------------------------------------------------------------ #
    def packages(self) -> JSON:
        """List the available credit packages and their prices."""
        return self._request(
            "GET", "/api/v1/billing", query={"action": "packages"}
        )

    def payment_history(self) -> JSON:
        """List the account's payment history."""
        return self._request(
            "GET", "/api/v1/billing", query={"action": "history"}
        )

    def buy_credits(
        self,
        package_id: str,
        method: str = "stripe",
        currency: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JSON:
        """Create a checkout to buy a credit package.

        Args:
            package_id: One of starter|basic|pro|business|enterprise.
            method: ``stripe`` (default) or ``crypto``.
            currency: Only for ``method="crypto"`` -- one of BTC|ETH|LTC|USDT|USDC.
                When set, returns a raw wallet address + amount + qr_code.
            idempotency_key: Passed through as the ``Idempotency-Key`` header.
                Auto-generated if omitted so retries never double-charge.

        Returns a Stripe or crypto checkout result.
        """
        body: JSON = {"package_id": package_id, "method": method}
        if currency is not None:
            body["currency"] = currency
        return self._request(
            "POST",
            "/api/v1/billing",
            body=body,
            idempotency_key=idempotency_key or str(uuid.uuid4()),
        )

    # ------------------------------------------------------------------ #
    # HTTP plumbing
    # ------------------------------------------------------------------ #
    def _request(
        self,
        method: str,
        path: str,
        query: Optional[JSON] = None,
        body: Optional[JSON] = None,
        auth: bool = True,
        idempotency_key: Optional[str] = None,
    ) -> JSON:
        url = self.base_url + path
        if query:
            url += "?" + urllib.parse.urlencode(query)

        headers = {
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        }
        if auth:
            if not self.api_key:
                raise VeriflyError(
                    "missing_api_key",
                    "An API key is required for this call. "
                    "Pass api_key to VeriflyClient(...).",
                )
            headers["Authorization"] = f"Bearer {self.api_key}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        data: Optional[bytes] = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        attempt = 0
        while True:
            attempt += 1
            try:
                payload, status, resp_headers = self._send(method, url, headers, data)
            except urllib.error.HTTPError as exc:
                payload, status, resp_headers = self._read_http_error(exc)
            except urllib.error.URLError as exc:
                if attempt <= self.max_retries:
                    time.sleep(self._backoff(attempt))
                    continue
                raise VeriflyError(
                    "http_error", f"Network error contacting Verifly: {exc.reason}"
                ) from exc

            request_id = resp_headers.get("x-request-id") or resp_headers.get(
                "X-Request-Id"
            )

            if status == 429 or status >= 500:
                if attempt <= self.max_retries:
                    retry_after = self._parse_retry_after(resp_headers)
                    time.sleep(
                        retry_after if retry_after is not None else self._backoff(attempt)
                    )
                    continue

            if status >= 400 or (isinstance(payload, dict) and payload.get("success") is False):
                self._raise_for_envelope(payload, status, request_id)

            if not isinstance(payload, dict):
                raise VeriflyError(
                    "invalid_response",
                    "Expected a JSON object response from Verifly.",
                    request_id,
                    status,
                )
            return payload

    def _send(self, method: str, url: str, headers: JSON, data: Optional[bytes]):
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            raw = resp.read().decode("utf-8")
            parsed = json.loads(raw) if raw else {}
            return parsed, resp.status, dict(resp.headers)

    @staticmethod
    def _read_http_error(exc: urllib.error.HTTPError):
        raw = exc.read().decode("utf-8") if exc.fp else ""
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"success": False, "error": {"code": "http_error", "message": raw or exc.reason}}
        return parsed, exc.code, dict(exc.headers or {})

    @staticmethod
    def _raise_for_envelope(payload: Any, status: int, request_id: Optional[str]) -> None:
        if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
            err = payload["error"]
            raise VeriflyError(
                err.get("code", "unknown_error"),
                err.get("message", "Unknown error"),
                request_id,
                status,
                err.get("suggestion"),
            )
        raise VeriflyError(
            "http_error",
            f"Request failed with HTTP {status}",
            request_id,
            status,
        )

    @staticmethod
    def _backoff(attempt: int) -> float:
        return min(2.0 ** (attempt - 1), 30.0)

    @staticmethod
    def _parse_retry_after(headers: JSON) -> Optional[float]:
        value = headers.get("Retry-After") or headers.get("retry-after")
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
