# @idp/operator

The minimal, **deliberately mocked** operator console (R6.4): list intervention requests, take control of the
same live session, approve or reject an irreversible step, resume, abort. It is a server-rendered page on
`node:http` that proxies to the session's localhost control API through `ControlClient`, so the browser never
sees the session token. The real operator product is a design in REPORT §5.

## Run

```bash
IDP_CONTROL_URL=http://127.0.0.1:<port> IDP_CONTROL_TOKEN=<token> IDP_OPERATOR_KEY=<console key> \
  pnpm --filter @idp/operator start
# → operator console at http://127.0.0.1:4030/login?k=<console key>
```

Usually started by `pnpm idp operator`, which passes the URL and token of a running attended session and a
fresh console key (40 random letters, written to `operator.key`, mode 0600, next to the token file and removed
when the console exits). Open the printed login URL once: it sets the session cookie.

## Configuration

| Variable            | Required | Meaning                                                    |
| ------------------- | -------- | ---------------------------------------------------------- |
| `IDP_CONTROL_URL`   | yes      | The session control API, e.g. `http://127.0.0.1:53211`.    |
| `IDP_CONTROL_TOKEN` | yes      | The session bearer token. Never printed, never served.     |
| `IDP_OPERATOR_KEY`  | yes      | The one-time console login key (32–128 of `A-Za-z0-9_-`; not the control token). |
| `IDP_OPERATOR_PORT` | no       | The console port (default `4030`; `0` = ephemeral).        |

A missing or invalid variable prints the variable name (never its value) and exits `64`; failing to start (e.g.
the port is taken) exits `1`. On start it prints `operator console at <url>/login?k=<key>`; SIGTERM/SIGINT
close it.

## Routes

| Route                                             | What                                                        |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `GET /login?k=<key>`                              | Exchanges the one-time key for the session cookie → 303 `/`. |
| `GET /`                                           | Intervention list, lease badge, Resume / Abort.             |
| `GET /interventions/:id`                          | Detail: masked screenshot, reason, step + risk, subject, redacted url/title, allowed actions. |
| `GET /evidence/:refId`                            | Proxied masked screenshot (PNG) or redacted snapshot (JSON). |
| `POST /interventions/:id/{claim,approve,reject}`  | Form post → control API → 303 back to the request.          |
| `POST /resume`, `POST /abort`                     | Form post → control API → 303 back (`return` field).        |
| `GET /api/state`                                  | JSON for the 2 s polling script: lease, request summary, version. |

A refused action redirects back with `?error=<CODE>` (e.g. `ILLEGAL_LEASE_TRANSITION`, `INVALID_OPERATOR`).

## Security

Bound to 127.0.0.1; a `Host` other than `127.0.0.1:<port>` / `localhost:<port>` → 421, a wrong method → 405.
**Authentication:** every route but `/login` needs the session cookie (`idp_console`, random, HttpOnly,
SameSite=Strict, path `/`) → otherwise 401 `LOGIN_REQUIRED`, without calling the session. `/login` compares the
key in constant time (wrong → 401 `LOGIN_REJECTED`) and works once (then 401 `LOGIN_KEY_USED`), so another
local process cannot read or approve without the key. Every POST also needs the per-process form token embedded in the
pages, and a same-origin `Origin` / `Sec-Fetch-Site` when the browser sends one (→ 403 `CSRF_REJECTED`).
Pages carry `Content-Security-Policy: default-src 'none'` plus a per-response nonce for the one inline script
and style (JSON and proxied evidence get `default-src 'none'; sandbox`). Every response sends `Cache-Control:
no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`; every
interpolated value is HTML-escaped. Everything shown is already redacted by the session.

## Exports

`OperatorServer` (`start({ control, port?, onError? })`, `url`, `address()`, `close()`), `OperatorControl`,
`loadOperatorConfig`, `DEFAULT_OPERATOR_PORT`, `OperatorConfigError` (`OPERATOR_CONFIG`),
`OperatorHttpError`, `OperatorServerStartError` (`OPERATOR_SERVER_START`).
