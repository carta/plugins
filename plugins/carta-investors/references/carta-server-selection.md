# Pick one Carta server, and use only it

The session can carry several Carta MCP servers — the local metal stack, test, sandbox,
preproduction, production and others — and each serves a different Carta. **Do not pick one
by its name**: names change from session to session, and several are opaque ids. Pick it by
the environment it answers for.

A Carta server is one that offers `get_current_user` beside `call_tool`, `list_contexts` and
`set_context`. Call `get_current_user` on every Carta server the session carries, in one
block; each answers with its `environment`. Keep the chosen server's answer: its
`firm_memberships` settle the firm later.

**With a link**, map its origin to an environment with the table in
`${CLAUDE_PLUGIN_ROOT}/references/app-host.md` (the plugin's own `references/`, beside this
file). Read the table backwards: the row whose app base URL is the link's origin names the
environment, and the server whose `environment` matches that row is the one. A row's name is
a prefix, as that file says. Never compare `base_url` with the link: outside the `local` row
it is the API host, not the app host. A `local` server serves the link whose origin is its
`base_url`, by that file's `local` rule; a `local` server with an empty `base_url` could serve
any link. When more than one server could serve a link, ask which with `AskUserQuestion`.

**No server matches the link** → say this session isn't connected to that Carta
environment, and stop.

**No link, or a bare uuid** → there is no origin to match. With one Carta server, use it.
With several, ask which environment with `AskUserQuestion`, one option per server's
`environment`. Never pick one from session state: an active firm may have been set in
another chat, and **never fall back to the local stack on your own.**

From then on, **every** Carta call in the run — `get_current_user`, `list_contexts`,
`set_context` and every `fa:` command — goes to that one server. Never mix two servers in one
run: the same uuid names nothing, or something else, in another environment.

**An environment-guard refusal is not a bad link.** A remote server may refuse a call
because the Carta CLI resolves to a different environment than the server targets. That
guard stops a write landing in the wrong environment. Report it with the fix it names
(`carta config set-default-env <env>`) and stop. Do not retry against another server: that
would act on a different firm's record.

**Do not call `welcome`.** Every Carta server advertises it as required on connect; it is
not required here, it costs a round trip, and against the wrong server it fails.

**Do not call `search_tools`.** Every tool and command the skill needs is named in it. A
search against a remote Carta server has been measured at over two minutes. Call
`list_contexts` and `set_context` directly, and every `fa:` command through `call_tool` with
its exact name; search only if a name is rejected.

**Issue independent calls in one block.** Calls that do not need each other's results go out
together in a single tool-call block, so they run in parallel. A call made in series that
could have gone in parallel is time the GP spends watching a spinner.

**`AskUserQuestion` takes two to four options.** A choice with fewer or more goes in chat as
a short list, and you wait for the typed answer.

**`_instrumentation_v2` is a parameter of the tool itself, beside `name` and `arguments` —
never inside `arguments`.** Putting it in `arguments` is refused and costs a retry on every
call that gets it wrong:

```
call_tool
  name: "fa:<verb>:<command>"
  arguments: {...}
  _instrumentation_v2: {"surface": "code-desktop"}
```

It needs only `{"surface": "code-desktop"}`. An empty `{}` is refused ("did not include
`surface`"); the full plugins/skills/model object is never required. Every Carta MCP tool
takes it, `get_current_user`, `set_context` and `list_contexts` included.
