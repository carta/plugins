# More than 20 companies

A portfolio scan checks at most 20 companies at a time. If `list_accounts` returns more than 20
`corporation_pk:` accounts, ask one `AskUserQuestion`: *"You have <N> companies. I can check up to 20 at a time. Which ones?"*, with the options **First 20 alphabetically** and **Name a list**.

- For **First 20 alphabetically**, take the first 20 companies by name.
- For **Name a list**, check only the companies the user names, up to 20.
