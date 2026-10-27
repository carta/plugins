"""What counts as Carta's document storage, for scripts that skills run
pre-approved and that therefore must refuse every other destination."""

from __future__ import annotations

import re
from urllib.parse import SplitResult, unquote

# Fund-admin's document buckets (helm values: prod and sandbox, prod-eu, and the
# demo/test default). Only these, not any *.amazonaws.com host: anyone can own a
# bucket or an API Gateway endpoint there.
CARTA_BUCKETS = frozenset({
    "investor-service-prod",
    "investor-service-eu-west-1-prod",
    "investor-service-demo",
})
S3_HOST = re.compile(r"^(?:(?P<bucket>[a-z0-9.-]+)\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$")


def is_carta_bucket(parts: SplitResult) -> bool:
    """A virtual-hosted (`<bucket>.s3….amazonaws.com`) or path-style
    (`s3….amazonaws.com/<bucket>/…`) URL on one of Carta's buckets.

    A `.` or `..` path segment, encoded or not, is refused outright: curl
    removes dot segments before sending, so `/<carta bucket>/../<other>/` would
    pass a check on the first segment and then reach the other bucket.
    """
    match = S3_HOST.match(parts.hostname or "")
    if not match or {".", ".."} & set(unquote(parts.path).split("/")):
        return False
    bucket = match.group("bucket") or parts.path.lstrip("/").split("/", 1)[0]
    return bucket in CARTA_BUCKETS
