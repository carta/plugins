# Gate — does this user have Carta Fund Administration?

Run this once, right after `welcome` succeeds, in a skill that needs a Fund Administration
subscription. The `welcome` response says it in one of two fields, and a session can carry
either one (a Sandbox session gives `fund_admin_access`; others give `is_fund_admin_user`).
Read both.

| `welcome` result | Action |
|---|---|
| `is_fund_admin_user: false` or `fund_admin_access: false` (a `false` in either name wins over a `true` in the other) | Stop with the calling skill's no-Fund-Admin message. |
| `is_fund_admin_user: true` or `fund_admin_access: true`, and neither `false` | Continue. |
| Both fields absent | Continue, and let the first Fund Administration call surface any access error. |

The calling skill owns the stop message and what it records when it stops; this file owns
which field values stop it.
