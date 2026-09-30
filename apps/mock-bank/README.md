# @idp/mock-bank

**CoreOne**, a deliberately hostile legacy core-banking back-office app used as the proxy target. It is
server-rendered HTML on `node:http` (no runtime dependencies) with a frameset, layout tables nested three or
more deep, labels in adjacent `<td>`s, generic control names (`txt1`, `btnGo`) and **no ids, test ids or
ARIA**. It holds **synthetic data only**, has deterministic fault switches, and a tenant-B variant of the
same code. The system treats it as a black box over HTTP; nothing imports this package.

## Run

```bash
pnpm --filter @idp/mock-bank build && pnpm --filter @idp/mock-bank start   # node dist/main.js
pnpm --filter @idp/mock-bank dev                                          # tsx watch src/main.ts
```

On start it prints `listening <url>` (the actually bound port) on stdout, and it stops cleanly on SIGTERM /
SIGINT.

### Environment

| Variable                   | Default     | Meaning                                                             |
| -------------------------- | ----------- | ------------------------------------------------------------------- |
| `MOCKBANK_PORT`            | `4010`      | Port; `0` = ephemeral (read the real one from `listening <url>`).   |
| `MOCKBANK_HOST`            | `127.0.0.1` | Bind address.                                                       |
| `MOCKBANK_TENANT`          | `a`         | `a` or `b` (see [Tenants](#tenants)).                               |
| `MOCKBANK_SESSION_IDLE_MS` | `900000`    | Session idle timeout (15 min).                                      |
| `MOCKBANK_SLOW_MS`         | `3000`      | Default delay of the `slow_load` fault.                             |
| `MOCKBANK_FAULTS`          | (none)      | Faults armed at start: comma list of `code[:mode][@route]`.         |

### Synthetic credentials

| User ID    | Password            | Entitlements                              |
| ---------- | ------------------- | ----------------------------------------- |
| `teller01` | `synthetic-pass-01` | member inquiry, open sub-account          |
| `teller02` | `synthetic-pass-02` | member inquiry only (sub-account → SEC-403) |

These are fake seed values for a local demo app; they protect nothing real. The system reads them from
`MOCKBANK_OPERATOR_USER` / `MOCKBANK_OPERATOR_PASSWORD`, never from an artifact.

### Synthetic members

| Member # | Name             | SSN (shown masked) | Share Savings | Checking  |
| -------- | ---------------- | ------------------ | ------------- | --------- |
| `12345`  | Jane Sample      | `***-**-3456`      | `1523.47`     | `842.10`  |
| `12346`  | John Placeholder | `***-**-4567`      | `904.00`      | `12.35`   |
| `24680`  | Ada Fixture      | `***-**-5678`      | `10250.00`    | `3999.99` |

SSNs are in the never-issued 900 range; account numbers are made-up 10-digit values (`8800…`). They are
shown in full on Member Inquiry on purpose, so redaction has something to catch.

## Screens

Every signed-in screen renders in the `content` frame. Titles and visible texts are a public contract: the
fixtures in `packages/artifact-schema/fixtures/` replay against them verbatim.

| Route                         | Title                           | Contents                                                                                                                    |
| ----------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                       | `CoreOne 7.4`                   | Frameset: `banner` (`/banner`), `nav` (`/nav`), `content` (`/login` signed out, `/member/search` signed in).                 |
| `GET /banner`                 | version                         | Institution name and version string.                                                                                        |
| `GET /nav`                    | `Menu`                          | Menu links with `target="content"`: Member Search, About CoreOne, Sign Off.                                                 |
| `GET /about`                  | `CoreOne - About`               | Product, build, licensee.                                                                                                   |
| `GET /login`                  | `CoreOne - Sign On`             | "Sign On"; rows "User ID" → `txtUser`, "Password" → `txtPwd` (password); button `Sign On`. `?reason=expired` adds the expiry message. |
| `POST /login`                 | —                               | Success → `303 /member/search` + session cookie `CORE1SESSID`. Failure → Sign On with red "Invalid User ID or Password".      |
| `GET /logout`                 | —                               | Ends the session → `302 /login`.                                                                                            |
| `GET /member/search`          | `CoreOne - Member Search`       | "Member Search"; row "Member #" → `txt1`; button `Search` (name `btnGo`); GET form to `/member/detail`.                        |
| `GET /member/detail?m=`       | `CoreOne - Member Inquiry`      | Also accepts `?txt1=` (the search form). "Member Inquiry"; rows Member #, Member Name, SSN (masked), Member Since, Branch; nested balances table "Share Savings" \| amount \| account #, "Checking" \| amount \| account #; link "Open Sub-Account" → `/subaccount/open?m=<id>`. |
| `GET /subaccount/open?m=`     | `CoreOne - Open Sub-Account`    | Row "Product" → `selProd` ("Holiday Club", "Vacation Savings"); "Initial Deposit" → `txtAmt`; "Nickname" → `txtNick`; button `Continue`. No hidden inputs (the member id is in the form action). |
| `POST /subaccount/confirm?m=` | `CoreOne - Confirm Sub-Account` | "Review Sub-Account" with the pending request (kept in the session); button `Confirm` with inline `onclick="return window.confirm('This action cannot be undone. Continue?')"`; link "Cancel" → Member Inquiry. |
| `POST /subaccount/opened`     | —                               | Commits the pending request (irreversible) → `303 /subaccount/opened`. No pending request → Member Search with "No pending sub-account request". |
| `GET /subaccount/opened`      | `CoreOne - Sub-Account Opened`  | "Sub-Account Opened"; rows "Confirmation #" \| `SA-000001` (in-memory sequence, 6 digits), member number, Product, Sub-Account Number (`99nnnnnnnn`), Initial Deposit, Nickname; link "Return to Member Search". Nothing opened in this session → `302 /member/search`. |

Messages are server-rendered `<font color="red">` text:

- "No records match your search criteria": unknown member (Member Search re-rendered).
- "Invalid Member Number": input that is not exactly 5 digits (Member Search re-rendered).
- "Invalid User ID or Password", "Your session has expired. Please sign on again." (Sign On).
- "You are not authorized for this function (SEC-403)": the security notice.
- "Invalid Product", "Invalid Initial Deposit", "Nickname is required",
  "Nickname must be 30 characters or fewer" (Open Sub-Account re-rendered).
- "No pending sub-account request": `POST /subaccount/opened` with nothing to commit (Member Search).

A signed-out request for any `/member/*` or `/subaccount/*` page redirects to `/login`; an idle-expired
session redirects to `/login?reason=expired` once. The `/subaccount/*` pages need the `open_subaccount`
entitlement; without it they render the SEC-403 security notice. An unknown path is a `404` "Page Not Found"
page; a known path with another method is `405`.

## Flows

1. **Sign on:** `/` → content `/login` → `POST /login` → `/member/search`.
2. **Member lookup:** Member Search → `GET /member/detail?txt1=12345&btnGo=Search` → Member Inquiry.
3. **Open sub-account (irreversible):** Member Inquiry → "Open Sub-Account" → form → Continue
   (`POST /subaccount/confirm`) → Review → Confirm (native `confirm`) → `POST /subaccount/opened` →
   Sub-Account Opened (`SA-nnnnnn`).

## Fault switches

Faults are deterministic: they fire only when armed, never at random. Each has a mode, `once` (disarms after
firing) or `always` (until cleared), and an optional **route** filter on the request path: a filter with `*`
is an anchored glob (`/subaccount/*`), one without is a path prefix (`/member/detail`). Without a route, the
fault applies on its **default route**. "Content pages" means every signed-in route under `/member/` and
`/subaccount/`. Faults never apply to `/__admin/**` or `/__health`; public pages (`/`, `/banner`, `/nav`, `/about`,
`/login`, `/logout`) are faulted only by an explicit route.

| Code                     | Default mode | Default route                       | What renders                                                                                                   |
| ------------------------ | ------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `member_not_found`       | once         | `/member/detail`                    | Member Search with red "No records match your search criteria", even for a seeded member.                      |
| `validation_error`       | once         | `/member/detail`                    | Member Search with red "Invalid Member Number", even for a valid number.                                       |
| `permission_denied`      | once         | `/member/detail`, `/subaccount/*`   | Security notice "You are not authorized for this function (SEC-403)" (HTTP 200).                               |
| `known_dialog`           | once         | `/member/detail`                    | Member Inquiry plus inline `<script>alert("Scheduled maintenance tonight at 11 PM");</script>`.               |
| `unknown_dialog`         | once         | `/member/detail`                    | Member Inquiry plus an inline `window.confirm("Printer queue PRN-07 is offline. Retry?")`.                     |
| `session_timeout`        | once         | content pages                       | Expires the session on that request → `302 /login?reason=expired` → Sign On with "Your session has expired".   |
| `slow_load`              | once         | content pages                       | The normal page, delayed by `delayMs` (per fault) or `MOCKBANK_SLOW_MS`.                                       |
| `failed_load`            | once         | content pages                       | HTTP 503, title "Service Unavailable".                                                                          |
| `failed_load_persistent` | always       | content pages                       | HTTP 503, title "Service Unavailable", on every matching request.                                              |
| `app_error`              | once         | content pages                       | HTTP 500, title "Server Error", text "Runtime Error — ORA-06512: at …".                                         |
| `control_missing`        | once         | `/member/search`                    | Member Search without the Search button (for `target_unresolved`).                                              |

Request-level faults are checked in this order, after the session check: `session_timeout`, `slow_load`
(then continues), `failed_load` / `failed_load_persistent`, `app_error`, `permission_denied`. The other codes
are applied by the screen that shows them.

### Admin API (tests and demos only; policy must never allow `/__admin/**`)

| Request                  | Body / effect                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `GET /__health`          | `200 ok`.                                                                                       |
| `GET /__admin/faults`    | The armed faults as JSON (`[{ code, mode, route?, delayMs?, fired }]`).                          |
| `POST /__admin/faults`   | JSON `{ "code": "...", "mode"?: "once"\|"always", "route"?: "/path", "delayMs"?: 500 }` → `201` with the list; `400` for an unknown code or bad field. |
| `DELETE /__admin/faults` | Disarms every fault → `204`.                                                                    |
| `POST /__admin/reset`    | Clears sessions, restarts the confirmation sequence at `SA-000001`, and re-arms exactly the `MOCKBANK_FAULTS` start-up set → `204`. |

`MOCKBANK_FAULTS` examples: `app_error`, `known_dialog:always`, `app_error@/member/detail,slow_load@/member/*`.

## Tenants

Tenant B is the same code with a different `Tenant` config (`src/tenants/tenants.ts`):

| Aspect              | Tenant A (`a`)                 | Tenant B (`b`)                      |
| ------------------- | ------------------------------ | ----------------------------------- |
| Version string      | `CoreOne 7.4` (build 7.4.0.311) | `CoreOne 7.2` (build 7.2.3.118)     |
| Branding            | First Synthetic Credit Union, navy | Placeholder Valley FCU, maroon  |
| Member-number label | `Member #`                     | `Account holder ID`                 |
| Search button       | `Search`                       | `Find`                              |
| Menu order          | Member Search, About, Sign Off | About, Sign Off, Member Search      |

Everything else (page titles, other labels, messages, routes, control names, data) is identical.

## Exports

`createMockBankServer(config?)` (returns `{ http, app, listen(), close() }`), `loadConfig(env)`,
`DEFAULT_CONFIG`, `FAULT_CODES`, `FAULT_DEFAULTS`, `TENANTS` and their types. They exist for the package's own
entry point and tests; by the boundary rules no other workspace may import this package.

## Tests

- Unit (`pnpm --filter @idp/mock-bank test`): session store (fake clock), fault parsing and switching, route
  matching, router table, config, legacy HTML escaping.
- Functional (`pnpm --filter @idp/mock-bank test:functional`, after `build`): spawns `node dist/main.js` on an
  ephemeral port (`test/functional/harness/startMockBank.ts`) and asserts over plain HTTP: `login`,
  `memberFlow`, `subAccountFlow`, `faults`, `tenantVariant`.
