# Closings in chat

Sets the table for every list of closing contacts in chat when no view has rendered, where it is the whole answer. With a view that rendered it lists the contacts, so write only the summary (item 2 of Display) and narrow the view with `filter_contacts` to the rows asked about. Use the rest of this file only when the user asks for the list in chat or asks about one investor ("One investor"). Steps 1 to 3 of `SKILL.md` have run, so the fund's `uuid`, `name` and `currency` are known and access is confirmed. Field meanings, state groups and paging are in `closing-contacts.md` beside this file.

## Display

1. **Leave existing partners out of the table** (the counting rule is in `closing-contacts.md`), and, when the rows read include any, add one line after the table: "Plus N existing partners from earlier closes." A `state` or `search` filter can leave them out; then add no line.
2. **Lead with a summary** naming every state group present, in the group order and with the summary phrases of `closing-contacts.md`, leaving out groups with none: "Acme Fund III has 18 closing contacts: 1 ready to countersign, 16 signing in progress, 1 awaiting KYC." When the user filtered by state or investor, say so and summarise only what was read.
3. **Table:** `#` | Investor | Collaborators | State | Data room | Commitment. Right-align `#` and Commitment (`|--:|` in the separator row).
   - Keep the rows in the order the command returns them; do not re-sort.
   - Investor names are plain text, never an ID or UUID.
   - **State** is the row's `status` label as returned (see the label table in `closing-contacts.md`), never the state key or the group label.
   - **Data room** is "Access granted" or "Not invited" from `invited_to_data_room`.
   - **Collaborators cell.** Names only, from `prospect_contacts`: signatories first, each as `Name (signatory)`, then the others in the order returned, not sorted. List a name once when two collaborators share it, and write a name that holds an email address without the address. Leave out filler, primary and secondary, and leave emails out. When the only collaborator has the investor's own name, write `Self` (`Self (signatory)` when they sign). When there are none, write `—`. After two names, write `+N` for the rest, e.g. `Adam Kerr, Asher Lu +2`.
   - **Commitment** is `commitment_amount`. When the LP-entered amount is a variance, add a second line in the same cell, joined with `<br>`: `A$15,000<br>LP entered A$45,000`. Show nothing for a "not entered" amount.
   - Show `—` for any missing value, never `0` or `null`.
   - Amounts use the fund's currency from Step 2: the currency symbol, then `X,XXX` with commas. Never add amounts in different currencies; give one total per currency if a total is asked for. Bold a total.
4. **Action summary** after the table, by urgency, naming the investors (up to five each, then "+ N more"): ready to countersign; commitment variances (LP differs from GP); prospects, who can be invited; signing in progress; awaiting KYC. Leave out a category with no rows.
5. **Links.** Under the action summary, give one line per investor named there that has a `_links.web_url`: `Acme LP: [View in Carta](<_links.web_url>)`, the URL verbatim. Never build or guess a Carta URL. A row with no `_links.web_url` gets no link.
6. End with next steps: refresh, filter by state, or invite the prospects.

## One investor

When the user asks about one investor, answer with two tables instead of the list table:

1. **Details**, one row per fact: Investor (`partner_name`); State, as the list table's State column writes it; Data room, as the list table's Data room column writes it; Contact email; GP commitment; LP entered, written "Not entered" for an amount `closing-contacts.md` calls not entered; Documents "Completed offline", only when `has_completed_documents_offline` is true.
2. **Collaborators:** Name | Email | Role, one row per person in `prospect_contacts`, roles from the `is_*` flags (signatory, filler, primary, secondary). With no collaborators, one row of `—`.

Amounts follow item 3 of Display. Several investors asked about by name get one pair of tables each.

## Refresh and diff

When the user asks to refresh, call the command again with the same fund and filters, compare with the previous read in this conversation, and report what changed: commitment changes (GP and LP), collaborators added or removed, and state moves. fund-admin keeps no change history, so only changes between reads in this conversation are visible.
