# Artifact fixtures

Hand-written capability artifacts (schema `1.0.0`) used as golden examples by the contract tests, the
replay engine's functional tests and the compiler's shape tests.

| File                             | What it is                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `member-lookup.artifact.json`    | Read-only: sign on, search a member, extract `savingsBalance` + `memberName`. |
| `open-sub-account.artifact.json` | Irreversible: sign on, search, open a sub-account, extract `confirmationNumber`. |
| `invalid/*.json`                 | `member-lookup` with exactly one defect each; every one must be rejected.     |

`CapabilityArtifact.test.ts` parses every valid fixture, checks its `contentHash`, and rejects every invalid
fixture at the defect path (the table `EXPECTED_PATH` in the test lists them).

## Editing a fixture

1. Edit the JSON. Write every defaulted field out (`required`, `sensitive`), so the parsed artifact equals the
   file and the hash is stable.
2. `pnpm --filter @idp/artifact-schema fixtures:hash` recomputes `contentHash` (it refuses an invalid artifact).
3. `pnpm exec prettier --write packages/artifact-schema/fixtures`.

Tests never rewrite hashes: a stale hash fails the build.

## Invalid fixtures

| File                                  | Defect                                                               | Rejected at                    |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| `concrete-member-number-literal.json` | Member # fill carries the literal `12345` while marked sensitive     | `steps[4].value`               |
| `missing-checkpoint.json`             | Search click without a checkpoint (invariant 5)                      | `steps[5].checkpoint`          |
| `undeclared-param.json`               | Fill references param `accountNumber`, which is not declared         | `steps[4].value.name`          |
| `undeclared-placeholder.json`         | `{{accountNumber}}` placeholder in the success condition             | `successCondition.text`        |
| `wrong-schema-version.json`           | `schemaVersion` is `2.0.0`                                           | `schemaVersion`                |
| `raw-password-literal.json`           | Password fill carries a literal password                             | `steps[2].value`               |
| `raw-password-in-credential-ref.json` | Credential reference smuggles a `value` key (strict object)          | `steps[2].value`               |
| `credential-ref-mismatch.json`        | Credential ref differs from the artifact `credentialRef`             | `steps[1].value.ref`           |
| `undeclared-output.json`              | Extract into output `memberEmail`, which is not declared             | `steps[7].output`              |
| `duplicate-step-id.json`              | Two steps share an id                                                | `steps[7].id`                  |
| `unknown-scope-step.json`             | Outcome rule scoped to a step id that does not exist                 | `outcomeRules[0].scope[0]`     |

## Mock-bank screen contract

`apps/mock-bank` must render **exactly** these screens so the fixtures replay unchanged. Text below is
verbatim. The app is "CoreOne" (tenant A reports `CoreOne 7.4`): same origin, server-rendered, no ids, no
test ids, no ARIA. Field labels sit in the adjacent `<td>`, not in a `<label for>`, so text inputs have **no
accessible name**; that is why input targets use a `structural` `form_row` rung first. Buttons are
`<input type="submit" value="…">`, so they do have role `button` with the value as their name. Every
content-frame target uses the frame scope `[{ "kind": "by_name", "name": "content" }]`.

| Route                    | Where         | Title                           | Contents                                                                                                                                                                                                                  |
| ------------------------ | ------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                  | top           | (any)                           | Frameset with three frames: `banner` (src `/banner`), `nav` (src `/nav`), `content` (src `/login` signed out, `/member/search` signed in).                                                                               |
| `/login`                 | content frame | `CoreOne - Sign On`             | Heading text "Sign On". Row "User ID" → input `txtUser`. Row "Password" → `input type=password` `txtPwd`. Button `Sign On`. Success → content frame shows `/member/search`.                                             |
| `/member/search`         | content frame | `CoreOne - Member Search`       | Text "Member Search". Row "Member #" → input `txt1`. Button `Search` (name `btnGo`), submits to `/member/detail`.                                                                                                      |
| `/member/detail?m=<id>`  | content frame | `CoreOne - Member Inquiry`      | Heading text "Member Inquiry". Nested table row "Member Name" \| `<name>`. Balances table rows "Share Savings" \| `<amount, e.g. 1523.47>` and "Checking" \| `<amount>`. Link "Open Sub-Account".                  |
| `/subaccount/open?m=<id>`| content frame | `CoreOne - Open Sub-Account`    | Row "Product" → select `selProd` with options "Holiday Club", "Vacation Savings". Row "Initial Deposit" → input `txtAmt`. Row "Nickname" → input `txtNick`. Button `Continue`.                                         |
| `/subaccount/confirm`    | content frame | `CoreOne - Confirm Sub-Account` | Text "Review Sub-Account". Button `Confirm` whose inline onclick calls `window.confirm("This action cannot be undone. Continue?")`.                                                                                     |
| `/subaccount/opened`     | content frame | `CoreOne - Sub-Account Opened`  | Text "Sub-Account Opened". Row "Confirmation #" \| `SA-000001` (a sequence).                                                                                                                                             |

Input order inside each form matters for the last-resort `nth_in_container` rungs: `txtUser` before `txtPwd`;
`txtAmt` before `txtNick`. The text "Initial Deposit" must be inside the Open Sub-Account form's container.

### Conditions (the fixtures' outcome rules match on this exact text)

| Condition             | Class            | How the app shows it                                                                     |
| --------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `member_not_found`    | business_outcome | Search page re-rendered with red text "No records match your search criteria".           |
| `validation_rejected` | business_outcome | Search page re-rendered with text "Invalid Member Number".                               |
| `permission_denied`   | business_outcome | Text "You are not authorized for this function (SEC-403)".                               |
| `known_dialog`        | recoverable      | Native `alert` "Scheduled maintenance tonight at 11 PM" on member detail load (accepted). |
| `session_timeout`     | recoverable      | Redirect to the Sign On page with text "Your session has expired" (re-auth once).        |
| `app_error`           | failure          | Title "Server Error", text "Runtime Error".                                              |

The operator credential is referenced as `mockbank-operator`; its values come from the environment at run
time and never appear in an artifact.
