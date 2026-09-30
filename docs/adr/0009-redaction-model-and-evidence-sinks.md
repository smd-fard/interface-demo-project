# ADR-0009: Redaction model and evidence sinks

| Field          | Value                                            |
| -------------- | ------------------------------------------------ |
| Status         | Accepted                                         |
| Date           | 2026-09-29                                       |
| Requirements   | R4.3, R5.1, R5.2, R6.1                           |
| Report section | 6                                                |
| Spec           | `_design/computer-use-automation-system/spec.md` |

## Context

R4.3 says secrets, credentials and full PII are never persisted. R5.1/R5.2 ask for a rich log and failure
evidence. Those pull against each other. There are six sinks: the run log, evidence files (screenshots, a11y
snapshots, `result.json`), artifacts, intervention requests, LLM prompts, and CLI output. The sensitive data
arrives from four places: caller params, the `.env` credential, values read off the screen, and whatever a human
types during a handoff. A rule that says "remember to redact" fails the first time someone adds a sink.

## Options

### A. One redactor in front of every sink, enforced by branded types

- ➕ `Redacted<T>` and `MaskedScreenshot` are brands from `@idp/policy`. `EvidenceStore.putScreenshot` /
  `putA11ySnapshot` / `putJson` accept only the brands, and `RunLog.log` redacts internally. Its unbranded
  `append` is private. So an unredacted write does not compile. `EvidenceRef.redacted` is the literal `true`.
- ➕ One masking decision serves text, prompts and screenshots, so they cannot disagree.
- ➖ The brand is a cast (`asMaskedScreenshot`). A careless caller can still lie to the compiler, so review has
  to watch the few call sites that mint a brand.

### B. Redact at read time or only on evidence export

- ➕ Raw logs help debugging, and there is one choke point at export.
- ➖ The raw data is persisted anyway, which breaks R4.3 as written. `.runs/` becomes a PII store, and LLM
  prompts have already left the machine before any export happens.

### C. A tokenization vault (values swapped for reversible tokens)

- ➕ Authorized users can recover values later, and joins across runs still work.
- ➖ It needs key management, access control and a service. That is heavy for a file-based PoC with synthetic
  data, and the vault becomes the thing to protect.

(Relying on reviewers and `/safety-review` alone is not an option. They are a backstop that runs after the data
is written.)

## Decision

**Option A.** `createRedactor` (`packages/policy/src/redaction/`) masks in a fixed order:

1. **Known sensitive values.** Params, credentials (seeded as soon as they are resolved) and extracted
   sensitive outputs (added with `addSensitiveValue`). Longest first. A value with a digit at its edge matches
   only at a digit boundary.
2. **Config patterns.** SSN is masked in `full`. A 10-digit account number is `keep_last_4`. A 5-digit member
   number is `keep_last_2`. Lookarounds keep the number patterns from matching inside `12,345.67`. A money
   amount is masked in `full` (see below).
3. **Synthetic name terms.** Matched without case and across any whitespace.

**Money amounts (`money-amount`, rules 1.0.0 → 1.1.0).** A real discovery run showed the model the Member
Inquiry page with `Checking 842.10` in clear. Balances are regulated financial data, and the model never needs
the digits: it locates the `Share Savings` row and `extract` reads the real value from the surface. So any
currency-like amount with exactly 2 decimals (optional thousands separators, optional leading `-`/`$`) is
masked whole before every sink, LLM prompts included. Word/`.`/`,` guards keep versions (`7.4`, `1.0.1`),
IPs and ports, integers, timestamps and hex out of it. Replay results returned to the caller keep their real
outputs; only the sink copies are masked. The artifact rule scan skips the declared `example` of a
non-sensitive param (e.g. a deposit amount `250.00`), but a literal amount in a step still fails: it must be a
param reference.

**Digests and name-like values (rules 1.1.0 → 1.2.0).** The member-number pattern masked 5-digit runs inside
the run log's observation digests (`sha256:5899f68e40f[•••45]`), corrupting them. Hex digests — a
`sha256:<8+ hex>` token or a standalone run of 32+ hex characters — are now exempt from the config patterns
and terms, and so is a URL authority (`http://127.0.0.1:61012`: the CLI printed an ephemeral control port as
`[•••12]`). They are not exempt from known-value masking: a known sensitive value is masked wherever it appears.
Known values that are name-like (letters, spaces, `'`, `.`, `-`; no digits) now match case-insensitively, like
the compiler's `TextGuard`, and only at word boundaries, so a param `Ann` masks `ANN` but not `Annual`. A
value with a digit edge keeps matching only at a digit boundary (whatever its length), so `12345` never
splits `8800123450`; any other value (a password, an id such as `AB12`) keeps case-sensitive substring
matching, which errs towards masking.

The masks are protected spans, and the redactor repeats until nothing changes, so it is idempotent. Per sink:

- **Run log and results.** `redactRunLogEntry` and `redactResultForSink` keep structural keys verbatim (ids,
  durations, enums) and redact the rest. Sensitive outputs are masked fully.
- **CLI.** `Printer` masks every line with every redactor it holds.
- **Intervention requests.** They are redacted before they are stored.
- **LLM prompts are placeholderized.** The model sees and types `{{memberId}}` and `{{credential.password}}`,
  and `toolToAction` substitutes the real value just before the surface acts. `formatObservation` wraps page text in an
  `<observation>` block. The system prompt calls that block untrusted data, never instructions.
- **Screenshots are masked in the browser.** `markSensitiveElements` marks, in every frame, each element whose
  text or input value the redactor would change. It also marks every value cell of a row with a sensitive
  header (`Share Savings`, `Member Name`, …). Then Playwright `mask` is applied, and only after that is the
  image branded.
- **Artifacts.** `assertNoConcreteValues` scans every string and key for example inputs, credentials and
  extracted values. It also runs free-text fields through the redaction rules. The compiler refuses a sensitive
  human fill that is not a param or credential reference (`UnparameterizedSensitiveValueError`).
- **Playwright traces are not captured or committed.** A trace holds the full DOM and network bodies, which
  cannot be redacted reliably. `EvidenceStore.putLocalOnly` exists, but nothing calls it and the CLI has no
  `--trace` flag. **This deviates from FR19/AC13.** Failure evidence is a masked screenshot plus a redacted a11y
  snapshot.

## Consequences

- **Easier:** adding a sink. It takes a brand, so the compiler forces the redaction. The same rules also drive
  `/safety-review` and the artifact guard. The model never learns the real member ID or password.
- **Harder:**
    - **Text-based masking has gaps.** It can miss a value split across DOM nodes (`123`<b>`45`</b>) or drawn
      in an image or canvas. Sensitive-row masking covers only the known table layouts.
    - **Known-value matching can over-mask.** A short param such as `12` masks every standalone `12`, so a
      short param can make logs harder to read.
    - **The model sees some values before they are protected.** A value is known to be sensitive only after
      its `extract`. Before that, only the patterns and terms protect it; since rules 1.1.0 a balance is covered
      by `money-amount`, but a value with no pattern (a free-form name, a comma-decimal amount such as
      `54321,10`) still reaches the model unmasked.
    - **`unknown_dialog` evidence has no screenshot.** A pending native dialog blocks the page's script, so
      nothing can be masked. The failure stores only the redacted blocked-page snapshot and says so in
      `observed`. The dialog message never appears.
    - **Traces are unavailable.** Debugging a failure without a trace is slower.
    - **Every run's data has to be declared.** Every new PII shape needs a pattern and a
      `REDACTION_RULES_VERSION` bump.
- **Revisit when:** real (non-synthetic) tenants arrive, which calls for a vault or a DLP service and
  per-tenant rules. Also revisit if Playwright can redact traces, or if a desktop surface needs pixel-level
  (OCR) masking.
