"""The hosts a report download URL may point at, shared by every script that fetches one."""

import json
from pathlib import Path
from typing import Set
from urllib.parse import urlparse

DOWNLOAD_TIMEOUT_SECONDS = 60

# Production Carta file hosts: the CDNs carta-mcp serves file links from in production.
BASE_HOSTS = frozenset({"documents.carta.com", "d5h5y18nrlwz0.cloudfront.net"})
# Staff-only extra hosts (preprod); the folder is not published, so customers get BASE_HOSTS.
STAFF_HOSTS_FILE = Path(__file__).resolve().parent.parent / "skills" / "carta-reporting" / "staff" / "allowed-hosts.json"


def load_allowed_hosts() -> Set[str]:
    hosts = set(BASE_HOSTS)
    if STAFF_HOSTS_FILE.is_file():
        hosts |= set(json.loads(STAFF_HOSTS_FILE.read_text()))
    return hosts


def check_download_url(url: str) -> None:
    """Raise ValueError unless url is https on an allowed host (hostname, so ':443' cannot slip past)."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in load_allowed_hosts():
        raise ValueError("Unexpected download URL host: %r" % parsed.netloc)
