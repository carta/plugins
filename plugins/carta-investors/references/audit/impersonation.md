# Impersonation

If the request frames this as impersonating another auditor or acting under a persona
— "as an auditor persona", "impersonate <name>", "run this as if I'm auditor X" — say
upfront that this connection has no impersonation channel. It always runs as whichever
identity completed the Carta login for this session, not a chosen persona. To test as
a specific auditor, that person's own credentials must complete the login. Then
proceed with whatever the caller's own connected identity actually has access to.

Never ask for or pass a `user_id`.

This applies regardless of which audit skill ends up handling the request — a
persona-framed question about readiness, what's new, or starting an engagement gets
the same disclosure as a persona-framed download.
