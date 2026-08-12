"""
Garmin Connect client for the trainy backend.

Adapted from https://github.com/diegoscarabelli/garmin-health-data — copies the
approach without importing the package. Key WAF-bypass techniques:
- 30-45 second delay between SSO page GET and credential POST (do not reduce)
- TLS fingerprinting via curl_cffi (optional, falls back to plain requests)
- 5-strategy login fallback chain
- DI OAuth2 Bearer tokens only (no JWT cookie fallback)
"""

import base64
import json
import logging
import random
import re
import time
from datetime import UTC, date, datetime
from typing import Any, TypedDict, cast

import requests
from requests.adapters import HTTPAdapter

try:
    from curl_cffi import requests as cffi_requests

    HAS_CFFI = True
except ImportError:
    HAS_CFFI = False

_LOG = logging.getLogger(__name__)

# ── Garmin endpoints ──────────────────────────────────────────────────────────

_SSO = "https://sso.garmin.com"
_CONNECTAPI = "https://connectapi.garmin.com"
_DI_TOKEN_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token"
_DI_GRANT_TYPE = (
    "https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket"
)

# Garmin rotates these quarterly; newest first so production uses the current one
_DI_CLIENT_IDS = (
    "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2",
    "GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4",
    "GARMIN_CONNECT_MOBILE_ANDROID_DI",
)

_PORTAL_CLIENT_ID = "GarminConnect"
_PORTAL_SERVICE_URL = "https://connect.garmin.com/app"
_MOBILE_CLIENT_ID = "GCM_ANDROID_DARK"
_MOBILE_SERVICE_URL = "https://mobile.integration.garmin.com/gcm/android"

# Cloudflare WAF bypass: sleep between SSO GET and credentials POST
_DELAY_MIN = 30.0
_DELAY_MAX = 45.0

_ACTIVITIES_PATH = "/activitylist-service/activities/search/activities"

_DESKTOP_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
_NATIVE_UA = "GCM-Android-5.23"
_NATIVE_X_GARMIN_UA = (
    "com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; "
    "Android/33; Dalvik/2.1.0"
)

_CSRF_RE = re.compile(r'name="_csrf"\s+value="(.+?)"')
_TITLE_RE = re.compile(r"<title>(.+?)</title>")
_TICKET_RE = re.compile(r'embed\?ticket=([^"]+)"')

_CFFI_PROFILES = ("chrome", "chrome110", "safari", "safari15_5", "edge99")


# ── Public types ──────────────────────────────────────────────────────────────


class TokenCache(TypedDict):
    di_token: str | None
    di_refresh_token: str | None
    di_client_id: str | None
    token_expires_at: str | None  # ISO UTC datetime or None


# ── Exceptions ────────────────────────────────────────────────────────────────


class GarminAuthError(Exception):
    """Bad credentials or MFA failure."""


class GarminRateLimitError(Exception):
    """HTTP 429 from Garmin / Cloudflare."""


class GarminConnectionError(Exception):
    """Network or unexpected response."""


# ── Helpers ───────────────────────────────────────────────────────────────────


def _basic_auth(client_id: str) -> str:
    return "Basic " + base64.b64encode(f"{client_id}:".encode()).decode()


def _native_headers(extra: dict | None = None) -> dict:
    h: dict = {
        "User-Agent": _NATIVE_UA,
        "X-Garmin-User-Agent": _NATIVE_X_GARMIN_UA,
        "X-Garmin-Paired-App-Version": "10861",
        "X-Garmin-Client-Platform": "Android",
        "X-App-Ver": "10861",
        "X-Lang": "en",
        "X-GCExperience": "GC5",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if extra:
        h.update(extra)
    return h


def _browser_headers() -> dict:
    return {"User-Agent": _DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9"}


def _decode_jwt_payload(token: str) -> dict:
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    padding = "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(parts[1] + padding).decode())
    except ValueError:
        return {}


def _token_exp_dt(token: str) -> datetime | None:
    exp = _decode_jwt_payload(token).get("exp")
    if exp:
        return datetime.fromtimestamp(int(exp), tz=UTC)
    return None


def _client_id_from_jwt(token: str) -> str | None:
    p = _decode_jwt_payload(token)
    return p.get("client_id") or p.get("aud") or None


def _token_expires_soon(token: str) -> bool:
    """True if the token expires within 15 minutes."""
    p = _decode_jwt_payload(token)
    exp = p.get("exp")
    return bool(exp and time.time() > int(exp) - 900)


# ── Main client class ─────────────────────────────────────────────────────────


class GarminClient:
    """
    Synchronous Garmin Connect client.

    Always call blocking methods via asyncio.to_thread() from async handlers.
    Token state flows in/out via TokenCache — the caller is responsible for
    persisting the returned cache to the database after each call.
    """

    def __init__(self, username: str, password: str) -> None:
        self.username = username
        self.password = password

        self.di_token: str | None = None
        self.di_refresh_token: str | None = None
        self.di_client_id: str | None = None
        self.token_expires_at: datetime | None = None

        # MFA session state, stashed during login when MFA is required
        self._mfa_session: Any | None = None
        self._mfa_params: dict | None = None
        self._mfa_headers: dict | None = None
        self._mfa_method: str = "email"
        self._mfa_strategy: str = "portal"

        self._api_session: requests.Session | None = None

    # ── Token cache I/O ──────────────────────────────────────────────────────

    def load_cache(self, cache: TokenCache) -> None:
        self.di_token = cache.get("di_token")
        self.di_refresh_token = cache.get("di_refresh_token")
        self.di_client_id = cache.get("di_client_id")
        raw_exp = cache.get("token_expires_at")
        self.token_expires_at = datetime.fromisoformat(raw_exp) if raw_exp else None

    def dump_cache(self) -> TokenCache:
        return TokenCache(
            di_token=self.di_token,
            di_refresh_token=self.di_refresh_token,
            di_client_id=self.di_client_id,
            token_expires_at=self.token_expires_at.isoformat()
            if self.token_expires_at
            else None,
        )

    @property
    def pending_mfa_state(self) -> str:
        """
        Serialize pending MFA state to JSON for DB storage.
        Only valid immediately after login() returned mfa_required=True.
        """
        if self._mfa_session is None:
            raise GarminAuthError("No pending MFA state")
        return json.dumps(
            {
                "strategy": self._mfa_strategy,
                "cookies": dict(self._mfa_session.cookies),
                "params": self._mfa_params,
                "headers": self._mfa_headers,
                "mfa_method": self._mfa_method,
            }
        )

    # ── Public API ────────────────────────────────────────────────────────────

    def login(self) -> tuple[TokenCache, bool]:
        """
        Authenticate using the 5-strategy fallback chain.

        Returns (cache, False) on success with tokens populated.
        Returns (empty_cache, True) when MFA is required — call
        pending_mfa_state to get JSON for DB, then resume_mfa() later.
        """
        strategies: list[tuple[str, Any]] = []
        if HAS_CFFI:
            strategies.append(("portal+cffi", self._portal_cffi))
        strategies.append(("portal+requests", self._portal_requests))
        if HAS_CFFI:
            strategies.append(("mobile+cffi", self._mobile_cffi))
        strategies.append(("mobile+requests", self._mobile_requests))
        if HAS_CFFI:
            strategies.append(("widget+cffi", self._widget_cffi))

        last_err: Exception | None = None
        for name, fn in strategies:
            try:
                _LOG.info("Garmin: trying strategy %s", name)
                mfa_required = fn()
                if mfa_required:
                    empty: TokenCache = TokenCache(
                        di_token=None,
                        di_refresh_token=None,
                        di_client_id=None,
                        token_expires_at=None,
                    )
                    return empty, True
                return self.dump_cache(), False
            except GarminAuthError:
                raise
            except (GarminRateLimitError, GarminConnectionError) as e:
                _LOG.warning("Strategy %s failed: %s", name, e)
                last_err = e
            except Exception as e:  # noqa: BLE001 - any failure must fall through to the next strategy
                _LOG.warning("Strategy %s unexpected error: %s", name, e)
                last_err = e

        raise GarminConnectionError(
            f"All login strategies failed. Last error: {last_err}"
        )

    def resume_mfa(self, mfa_state_json: str, mfa_code: str) -> TokenCache:
        """Complete an MFA challenge from persisted state."""
        state = json.loads(mfa_state_json)
        sess = requests.Session()
        sess.cookies.update(state["cookies"])
        self._mfa_session = sess
        self._mfa_params = state["params"]
        self._mfa_headers = state["headers"]
        self._mfa_method = state.get("mfa_method", "email")
        self._mfa_strategy = state.get("strategy", "portal")

        if self._mfa_strategy == "widget":
            self._complete_mfa_widget(mfa_code)
        else:
            self._complete_mfa_portal(mfa_code)

        return self.dump_cache()

    def get_activities(
        self,
        cache: TokenCache,
        start_date: date,
        end_date: date,
    ) -> tuple[list[dict], TokenCache]:
        """
        Fetch all activities in the date range. Returns (activities, updated_cache).
        Never fetches beyond the given range.
        """
        self.load_cache(cache)
        if not self.di_token:
            raise GarminAuthError("Not authenticated — login first")

        if _token_expires_soon(self.di_token):
            self._refresh_di_token()

        activities: list[dict] = []
        start = 0
        limit = 20
        params: dict = {
            "startDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
            "limit": str(limit),
        }

        while True:
            params["start"] = str(start)
            resp = self._api_get(_ACTIVITIES_PATH, params=params)
            if resp.status_code == 204:
                break
            page: list = resp.json()
            if not page:
                break
            activities.extend(page)
            start += limit
            if len(page) < limit:
                break

        return activities, self.dump_cache()

    # ── Login strategies ─────────────────────────────────────────────────────

    def _portal_cffi(self) -> bool:
        for idx, profile in enumerate(_CFFI_PROFILES):
            try:
                sess = cffi_requests.Session(impersonate=cast(Any, profile), timeout=30)
                # Full WAF delay on first attempt only; subsequent profiles use a short retry delay
                delay = (
                    random.uniform(_DELAY_MIN, _DELAY_MAX)
                    if idx == 0
                    else random.uniform(2, 5)
                )
                return self._portal_web_flow(sess, strategy="portal", delay=delay)
            except (GarminRateLimitError, GarminAuthError):
                raise
            except Exception as e:  # noqa: BLE001 - any failure must fall through to the next profile
                _LOG.debug("portal+cffi profile=%s: %s", profile, e)
        raise GarminConnectionError("portal+cffi: all TLS profiles failed")

    def _portal_requests(self) -> bool:
        return self._portal_web_flow(requests.Session(), strategy="portal")

    def _mobile_cffi(self) -> bool:
        sess = cffi_requests.Session(impersonate="safari15_5", timeout=30)
        return self._portal_web_flow(sess, strategy="mobile", use_mobile_endpoint=True)

    def _mobile_requests(self) -> bool:
        return self._portal_web_flow(
            requests.Session(), strategy="mobile", use_mobile_endpoint=True
        )

    def _portal_web_flow(
        self,
        sess: Any,
        strategy: str = "portal",
        use_mobile_endpoint: bool = False,
        delay: float | None = None,
    ) -> bool:
        """
        Core portal/mobile JSON login flow.

        The 30-45 second sleep between GET and POST is the primary Cloudflare WAF
        bypass. Garmin's Cloudflare blocks back-to-back SSO requests without it.
        """
        client_id = _MOBILE_CLIENT_ID if use_mobile_endpoint else _PORTAL_CLIENT_ID
        service_url = (
            _MOBILE_SERVICE_URL if use_mobile_endpoint else _PORTAL_SERVICE_URL
        )
        api_endpoint = "mobile" if use_mobile_endpoint else "portal"

        signin_url = f"{_SSO}/portal/sso/en-US/sign-in"
        browser_hdrs = _browser_headers()

        get_resp = sess.get(
            signin_url,
            params={"clientId": client_id, "service": service_url},
            headers={
                **browser_hdrs,
                "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            },
            timeout=30,
        )
        if get_resp.status_code == 429:
            raise GarminRateLimitError(f"{strategy} GET 429")
        if not get_resp.ok:
            raise GarminConnectionError(f"{strategy} GET {get_resp.status_code}")

        actual_delay = (
            delay if delay is not None else random.uniform(_DELAY_MIN, _DELAY_MAX)
        )
        _LOG.info(
            "%s login: waiting %.0fs (Cloudflare WAF bypass)", strategy, actual_delay
        )
        time.sleep(actual_delay)

        login_url = f"{_SSO}/{api_endpoint}/api/login"
        login_params = {
            "clientId": client_id,
            "locale": "en-US",
            "service": service_url,
        }
        post_headers = {
            **browser_hdrs,
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Origin": _SSO,
            "Referer": f"{signin_url}?clientId={client_id}&service={service_url}",
        }

        r = sess.post(
            login_url,
            params=login_params,
            headers=post_headers,
            json={
                "username": self.username,
                "password": self.password,
                "rememberMe": True,
                "captchaToken": "",
            },
            timeout=30,
        )
        if r.status_code == 429:
            raise GarminRateLimitError(f"{strategy} POST 429")
        if not r.ok:
            raise GarminConnectionError(
                f"{strategy} POST {r.status_code}: {r.text[:200]}"
            )

        try:
            res = r.json()
        except Exception as e:
            raise GarminConnectionError(
                f"{strategy} POST non-JSON: {r.text[:200]}"
            ) from e

        resp_type = res.get("responseStatus", {}).get("type")

        if resp_type == "MFA_REQUIRED":
            self._mfa_method = res.get("customerMfaInfo", {}).get(
                "mfaLastMethodUsed", "email"
            )
            self._mfa_session = sess
            self._mfa_params = login_params
            self._mfa_headers = post_headers
            self._mfa_strategy = "portal"
            return True

        if resp_type == "SUCCESSFUL":
            ticket = res.get("serviceTicketId")
            if not ticket:
                raise GarminConnectionError(
                    f"{strategy}: SUCCESSFUL response missing serviceTicketId"
                )
            self._exchange_ticket(ticket, service_url)
            return False

        if resp_type == "INVALID_USERNAME_PASSWORD":
            raise GarminAuthError("Invalid username or password")

        raise GarminConnectionError(
            f"{strategy}: unexpected response type: {resp_type!r}"
        )

    def _widget_cffi(self) -> bool:
        """SSO embed widget flow — last resort, frequently 429'd."""
        sess = cffi_requests.Session(impersonate="chrome", timeout=30)
        sso_base = f"{_SSO}/sso"
        sso_embed = f"{sso_base}/embed"
        embed_params = {
            "id": "gauth-widget",
            "embedWidget": "true",
            "gauthHost": sso_base,
        }
        signin_params = {
            **embed_params,
            "gauthHost": sso_embed,
            "service": sso_embed,
            "source": sso_embed,
            "redirectAfterAccountLoginUrl": sso_embed,
            "redirectAfterAccountCreationUrl": sso_embed,
        }

        r = sess.get(sso_embed, params=embed_params)
        if r.status_code == 429:
            raise GarminRateLimitError("widget embed GET 429")
        if not r.ok:
            raise GarminConnectionError(f"widget embed GET {r.status_code}")

        r = sess.get(
            f"{sso_base}/signin", params=signin_params, headers={"Referer": sso_embed}
        )
        if r.status_code == 429:
            raise GarminRateLimitError("widget signin GET 429")

        csrf = _CSRF_RE.search(r.text)
        if not csrf:
            raise GarminConnectionError("widget: no CSRF token in sign-in page")

        r = sess.post(
            f"{sso_base}/signin",
            params=signin_params,
            headers={"Referer": r.url},
            data={
                "username": self.username,
                "password": self.password,
                "embed": "true",
                "_csrf": csrf.group(1),
            },
        )
        if r.status_code == 429:
            raise GarminRateLimitError("widget POST 429")

        title_m = _TITLE_RE.search(r.text)
        title = title_m.group(1) if title_m else ""

        if "MFA" in title:
            self._mfa_session = sess
            self._mfa_params = signin_params
            self._mfa_headers = {"Referer": r.url}
            self._mfa_method = "email"
            self._mfa_strategy = "widget"
            return True

        if title.lower() != "success":
            if any(
                h in title.lower() for h in ("invalid", "locked", "error", "incorrect")
            ):
                raise GarminAuthError(f"widget: auth failed ({title!r})")
            raise GarminConnectionError(f"widget: unexpected title {title!r}")

        ticket_m = _TICKET_RE.search(r.text)
        if not ticket_m:
            raise GarminConnectionError("widget: no ticket in success page")
        self._exchange_ticket(ticket_m.group(1), sso_embed)
        return False

    # ── MFA completion ────────────────────────────────────────────────────────

    def _complete_mfa_portal(self, mfa_code: str) -> None:
        """Complete MFA via portal or mobile verifyCode endpoints."""
        sess = self._mfa_session
        assert sess is not None
        mfa_json = {
            "mfaMethod": self._mfa_method,
            "mfaVerificationCode": mfa_code,
            "rememberMyBrowser": True,
            "reconsentList": [],
            "mfaSetup": False,
        }
        endpoints = [
            (
                f"{_SSO}/portal/api/mfa/verifyCode",
                self._mfa_params,
                self._mfa_headers,
            ),
            (
                f"{_SSO}/mobile/api/mfa/verifyCode",
                {
                    "clientId": _MOBILE_CLIENT_ID,
                    "locale": "en-US",
                    "service": _MOBILE_SERVICE_URL,
                },
                self._mfa_headers,
            ),
        ]

        last_err: Exception | None = None
        for url, params, headers in endpoints:
            try:
                r = sess.post(
                    url, params=params, headers=headers, json=mfa_json, timeout=30
                )
            except OSError as e:
                last_err = GarminConnectionError(str(e))
                continue

            if r.status_code == 429:
                last_err = GarminRateLimitError(f"MFA {url} 429")
                continue
            if not r.ok:
                last_err = GarminConnectionError(f"MFA {url} {r.status_code}")
                continue

            try:
                res = r.json()
            except ValueError:
                last_err = GarminConnectionError(f"MFA non-JSON: {r.text[:200]}")
                continue

            resp_type = res.get("responseStatus", {}).get("type")
            if resp_type == "SUCCESSFUL":
                ticket = res.get("serviceTicketId") or res.get("serviceTicket")
                if ticket:
                    svc = (self._mfa_params or {}).get("service", _PORTAL_SERVICE_URL)
                    self._exchange_ticket(ticket, svc)
                    return
                raise GarminConnectionError("MFA SUCCESSFUL but no serviceTicketId")
            if resp_type in ("INVALID_MFA_CODE", "INVALID_CODE"):
                raise GarminAuthError("Invalid MFA code")

            last_err = GarminConnectionError(f"MFA unexpected response: {resp_type!r}")

        raise last_err or GarminConnectionError(
            "MFA completion failed on all endpoints"
        )

    def _complete_mfa_widget(self, mfa_code: str) -> None:
        sess = self._mfa_session
        assert sess is not None
        r = sess.post(
            f"{_SSO}/sso/verifyMFA/loginEnterMfaCode",
            params=self._mfa_params,
            headers=self._mfa_headers,
            data={
                "mfa-code": mfa_code,
                "embed": "true",
                "fromPage": "setupEnterMfaCode",
            },
        )
        if r.status_code == 429:
            raise GarminRateLimitError("widget MFA 429")

        title_m = _TITLE_RE.search(r.text)
        title = title_m.group(1) if title_m else ""
        if title.lower() != "success":
            raise GarminAuthError(f"Widget MFA failed: {title!r}")

        ticket_m = _TICKET_RE.search(r.text)
        if not ticket_m:
            raise GarminConnectionError("widget MFA: no ticket in success page")

        sso_embed = f"{_SSO}/sso/embed"
        self._exchange_ticket(ticket_m.group(1), sso_embed)

    # ── DI token exchange ─────────────────────────────────────────────────────

    def _exchange_ticket(self, ticket: str, service_url: str) -> None:
        """Convert a CAS service ticket to DI OAuth2 Bearer tokens."""
        for client_id in _DI_CLIENT_IDS:
            try:
                r = self._di_post(
                    headers=_native_headers(
                        {
                            "Authorization": _basic_auth(client_id),
                            "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
                            "Content-Type": "application/x-www-form-urlencoded",
                            "Cache-Control": "no-cache",
                        }
                    ),
                    data={
                        "client_id": client_id,
                        "service_ticket": ticket,
                        "grant_type": _DI_GRANT_TYPE,
                        "service_url": service_url,
                    },
                )
            except OSError as e:
                _LOG.debug("DI exchange transport error for %s: %s", client_id, e)
                continue

            if r.status_code == 429:
                raise GarminRateLimitError("DI exchange 429")
            if not r.ok:
                _LOG.debug("DI exchange %s: HTTP %s", client_id, r.status_code)
                continue

            try:
                data = r.json()
                token = data["access_token"]
                refresh = data.get("refresh_token")
                if not refresh:
                    _LOG.debug("DI exchange %s: missing refresh_token", client_id)
                    continue
                self.di_token = token
                self.di_refresh_token = refresh
                self.di_client_id = _client_id_from_jwt(token) or client_id
                self.token_expires_at = _token_exp_dt(token)
                return
            except (ValueError, KeyError) as e:
                _LOG.debug("DI exchange parse error for %s: %s", client_id, e)

        raise GarminAuthError("DI token exchange failed for all client IDs")

    def _refresh_di_token(self) -> None:
        if not self.di_refresh_token or not self.di_client_id:
            raise GarminAuthError("No refresh token — must re-login")

        r = self._di_post(
            headers=_native_headers(
                {
                    "Authorization": _basic_auth(self.di_client_id),
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Cache-Control": "no-cache",
                }
            ),
            data={
                "grant_type": "refresh_token",
                "client_id": self.di_client_id,
                "refresh_token": self.di_refresh_token,
            },
        )
        if r.status_code == 429:
            raise GarminRateLimitError("Token refresh 429")
        if not r.ok:
            raise GarminAuthError(f"Token refresh failed: HTTP {r.status_code}")

        data = r.json()
        token = data.get("access_token")
        if not token:
            raise GarminAuthError("Token refresh: missing access_token in response")

        self.di_token = token
        self.di_refresh_token = data.get("refresh_token", self.di_refresh_token)
        self.di_client_id = _client_id_from_jwt(token) or self.di_client_id
        self.token_expires_at = _token_exp_dt(token)

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _di_post(**kwargs: Any) -> requests.Response:
        """POST to diauth.garmin.com with curl_cffi if available."""
        if HAS_CFFI:
            return cast(
                requests.Response,
                cffi_requests.post(
                    _DI_TOKEN_URL, impersonate="chrome", timeout=30, **kwargs
                ),
            )
        return requests.post(_DI_TOKEN_URL, timeout=30, **kwargs)  # type: ignore[call-overload]

    def _api_headers(self) -> dict:
        return _native_headers(
            {"Authorization": f"Bearer {self.di_token}", "Accept": "application/json"}
        )

    def _api_get(self, path: str, **kwargs: Any) -> requests.Response:
        """Authenticated GET to connectapi.garmin.com, auto-retries once on 401."""
        if self._api_session is None:
            self._api_session = requests.Session()
            self._api_session.mount(
                "https://", HTTPAdapter(pool_connections=10, pool_maxsize=10)
            )

        url = f"{_CONNECTAPI}/{path.lstrip('/')}"
        kwargs.setdefault("timeout", 15)

        resp = self._api_session.get(url, headers=self._api_headers(), **kwargs)
        if resp.status_code == 401:
            self._refresh_di_token()
            resp = self._api_session.get(url, headers=self._api_headers(), **kwargs)
        if resp.status_code == 429:
            raise GarminRateLimitError(f"API GET 429: {path}")
        if not resp.ok:
            raise GarminConnectionError(
                f"API GET {path}: HTTP {resp.status_code}: {resp.text[:200]}"
            )
        return resp
