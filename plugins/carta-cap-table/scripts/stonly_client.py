"""
urllib-based Stonly API client for the carta-cap-table glossary sync.
Auth: HTTP Basic using STONLY_API_KEY env var (never argv).
"""
from __future__ import annotations
import base64, json, os, urllib.error, urllib.request
from typing import Any

STONLY_BASE = "https://public.stonly.com/api/v3"
TEAM_ID = "43540"


class StonlyError(Exception):
    pass


class StonlyClient:
    def __init__(self, api_key: str | None = None):
        key = api_key or os.environ.get("STONLY_API_KEY")
        if not key:
            raise StonlyError("STONLY_API_KEY not set")
        credentials = base64.b64encode(f"carta-api-client:{key}".encode()).decode()
        self._auth_header = f"Basic {credentials}"

    def export_guide(self, guide_id: str) -> list[dict]:
        """Fetch all steps for a guide. Returns list of step dicts."""
        path = f"/guide/export?contentId={guide_id}&teamId={TEAM_ID}"
        return self._request("GET", path)

    def append_step(
        self,
        guide_id: str,
        parent_id: int,
        content: str,
        title: str | None = None,
        choice_label: str | None = None,
        position: int | None = None,
    ) -> int:
        """Append a new step after parent_id. Returns new step ID."""
        body: dict[str, Any] = {
            "guideId": guide_id,
            "parentStepId": parent_id,
            "content": content,
        }
        if title is not None:
            body["title"] = title
        if choice_label is not None:
            body["choiceLabel"] = choice_label
        if position is not None:
            body["position"] = position

        resp = self._request("POST", "/guide/step", body)

        # Parse step ID defensively: try id, stepId, data.id
        if isinstance(resp, dict):
            if "id" in resp:
                return int(resp["id"])
            if "stepId" in resp:
                return int(resp["stepId"])
            data = resp.get("data")
            if isinstance(data, dict) and "id" in data:
                return int(data["id"])

        raise StonlyError(f"Could not find step ID in response: {resp!r}")

    def link_steps(
        self,
        guide_id: str,
        source_id: int,
        target_id: int,
        choice_label: str | None = None,
        position: int | None = None,
    ) -> None:
        """Add a navigation transition from source to target."""
        body: dict[str, Any] = {
            "guideId": guide_id,
            "sourceStepId": source_id,
            "targetStepId": target_id,
        }
        if choice_label is not None:
            body["choiceLabel"] = choice_label
        if position is not None:
            body["position"] = position

        self._request("POST", "/guide/step/link", body)

    def publish(self, guide_id: str) -> str:
        """Publish the guide. Returns job_id."""
        body = {"guideList": [{"guideId": guide_id}]}
        resp = self._request("POST", "/guide/publish", body)

        if isinstance(resp, dict):
            if "jobId" in resp:
                return str(resp["jobId"])
            if "job_id" in resp:
                return str(resp["job_id"])

        raise StonlyError(f"Could not find job ID in response: {resp!r}")

    def job_status(self, job_id: str) -> dict:
        """Poll job status. Returns the full response dict."""
        return self._request("GET", f"/job/{job_id}")

    def _request(self, method: str, path: str, body: dict | None = None) -> Any:
        """Make an authenticated request. Raises StonlyError on HTTP errors."""
        url = STONLY_BASE + path
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")

        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", self._auth_header)
        if body is not None:
            req.add_header("Content-Type", "application/json")

        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read()
                if raw:
                    return json.loads(raw)
                return None
        except urllib.error.HTTPError as e:
            code = e.code
            try:
                detail = e.read().decode("utf-8", errors="replace")
            except Exception:
                detail = str(e)

            if code == 401:
                raise StonlyError("bad/missing API key") from e
            if code == 403:
                raise StonlyError("no write scope") from e
            if code == 404:
                raise StonlyError(f"not found: {path}") from e
            raise StonlyError(f"HTTP {code}: {detail}") from e
