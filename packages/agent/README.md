# @idp/agent

The discovery side of the system (R1, R2): an LLM drives a live UI through the `Surface` port (observe →
decide → act) until a natural-language goal is met, and the **artifact compiler** turns that run into a
typed, versioned capability artifact. It is the only package that imports `@anthropic-ai/sdk`.
`@idp/replay-engine` never depends on it (invariant 1): replay runs the artifact with no model.

## Usage

```ts
import { AnthropicModelClient, DiscoveryRunner, ScriptedModel } from '@idp/agent';

const model = keyless
	? await ScriptedModel.fromFile('packages/agent/scripts/member-lookup.script.json')
	: new AnthropicModelClient(); // reads ANTHROPIC_API_KEY and IDP_MODEL from process.env

const run = await new DiscoveryRunner({
	goal: 'Look up member 12345 and return the Share Savings balance and the member name',
	params: [{ name: 'memberId', description: 'The 5-digit member number.', type: { kind: 'string' } }],
	exampleInputs: { memberId: '12345' },
	credentials: { username: process.env.MOCKBANK_OPERATOR_USER!, password: process.env.MOCKBANK_OPERATOR_PASSWORD! },
	profile, // AppProfile with origin expanded
	policy, // ResolvedPolicy
	model,
	runsRoot: 'runs',
}).run();
// run.outcome.kind === 'goal_met' → run.artifactPath is <runsRoot>/<runId>/artifact.json
```

## The run: `DiscoveryRunner`

`new DiscoveryRunner(options: DiscoveryRunnerOptions).run(): Promise<DiscoveryRunResult>`

1. Builds **one redactor** seeded with the example inputs (as `{{param}}` placeholders) and the credentials. It
   serves the session sinks, the prompts and the compiler (invariant 3).
2. Opens a live session (`@idp/session`, run kind `discovery`, actor `agent`, unattended by default).
3. Runs the `DiscoveryLoop` (entry route: `target`, default `profile.loginRoute`).
4. On `goal_met` only: `ArtifactCompiler.compile` → `assertNoConcreteValues` (with the policy's redaction
   rules) → writes `artifact.json` and a `success` `result.json` (sensitive outputs masked).
5. On `stopped`: writes a `failure` `result.json` (reason from `STOP_FAILURE_REASONS`, exact stop reason in
   `observed`) and no artifact. A goal met that does not compile writes `failure` / `artifact_invalid` and
   rethrows the compiler error.

The session is always closed (manifest written) before `run()` returns or throws. Model prompts are written as
`prompts/turn-NN.json`, redacted again at the end of the run with every value known by then.

## The loop: `DiscoveryLoop`

`DiscoveryLoop.run(input: DiscoveryLoopInput): Promise<DiscoveryOutcome>` never compiles. Each turn it shows the
model the placeholderized observation, acts on the **first** tool call only (extra calls get an error result),
sends the action through the leased, policy-guarded surface, and records a `TraceStep` (fingerprint, digests
before and after, `ScreenDiff`, verdict). Unknown tools, invalid input, policy denials and stale refs go back to
the model as error tool results and count toward the budget. An irreversible action asks the session for
approval (`requestApproval`); `request_help` or a dead end escalates to a human (`escalate`), whose recorded
actions join the trace as `human` steps.

`DiscoveryOutcome` is `{ kind: 'goal_met', trace, finalCheckpoint, summary, extracted, turns }` or
`{ kind: 'stopped', reason, detail, trace, turns, interventionRequestId? }`.

### Stop conditions (`StopConditions`, `DEFAULT_STOP_OPTIONS`)

| Stop reason       | Trips when                                                                                    | Default          | `result.json` reason |
| ----------------- | --------------------------------------------------------------------------------------------- | ---------------- | -------------------- |
| `max_steps`       | the model-turn budget is used up (refused and failed turns count)                             | `maxSteps` 25    | `timeout`            |
| `timeout`         | the wall-clock budget runs out (injected clock)                                               | `timeoutMs` 300 000 | `timeout`         |
| `dead_end`        | the same screen digest N times in a row, or an A-B-A-B oscillation, and no operator helped    | `deadEndRepeats` 3 | `recovery_exhausted` |
| `policy_blocked`  | N policy denials with no performed action between, or an irreversible action not approved   | `policyBlockedLimit` 3 | `policy_denied` |
| `goal_unverified` | N `finish` calls whose checkpoint did not hold on screen                                      | `unverifiedFinishLimit` 2 | `checkpoint_failed` |
| `model_gave_up`   | a turn without a tool call, or `request_help` with no operator helping                        | —                | `recovery_exhausted` |
| `human_aborted`   | an operator aborted the run or rejected an approval                                           | —                | `human_aborted`      |

Budgets are set through `DiscoveryLoopOptions` (`Partial<StopOptions>` plus `clock` and `verifyTimeoutMs`,
default 5000 ms). A non-positive budget throws `DiscoveryConfigError`.

## Model port and adapters

- `ModelClient` — `{ modelId; next(request: ModelRequest): Promise<ModelTurn> }`. Everything in a
  `ModelRequest` (`system`, `messages: ModelMessage[]`, `tools: ModelToolSpec[]`) is already redacted.
  `ModelTurn` carries `toolCalls`, `text`, `stopReason` (`ModelStopReason`), `usage` (`ModelUsage`) and opaque
  `providerContent` that is echoed back verbatim (keeps thinking blocks valid).
- `AnthropicModelClient(options?: AnthropicModelClientOptions)` — the Messages API with tool use. The model is
  `options.model` ?? `IDP_MODEL` ?? `DEFAULT_ANTHROPIC_MODEL` (`claude-sonnet-5-5`), and `modelId` is
  `anthropic:<model>`. `max_tokens` defaults to `DEFAULT_MAX_TOKENS` (8192). `effort` (`AnthropicEffort`) is
  optional, retries default to 2 and the timeout to 120 s. Prompt caching is on for the system prompt, the tool
  list (breakpoint on the last tool) and the conversation. Parallel tool use is off. It throws
  `MissingApiKeyError` (`MISSING_API_KEY`) at construction when `ANTHROPIC_API_KEY` is unset or blank. SDK
  failures become `ModelCallError` (`status`, `retryable`), and the key is never in the message.
- `ScriptedModel(script)` / `ScriptedModel.fromFile(path)` — a deterministic fake that plays one scripted
  tool call per turn, with no network. `modelId` is `scripted:<name>`. It resolves a target against the
  **last `<observation>` block** in the request (the text a real model sees), so a script works only if the
  observation really exposes the element. `requests` holds a copy of every request (tests assert that no raw
  value reached a prompt). It throws `ScriptError` (`SCRIPT_INVALID`, `SCRIPT_EXHAUSTED`,
  `SCRIPT_TARGET_NOT_FOUND`, `SCRIPT_NO_OBSERVATION`).

### Script format (`scripts/*.script.json`, `ModelScriptSchema`)

```json
{
	"scriptVersion": 1,
	"name": "member-lookup",
	"steps": [
		{ "tool": "navigate", "input": { "route": "/", "reason": "Open the entry page." } },
		{
			"tool": "fill",
			"target": { "role": "textbox", "label": "Member #", "frame": "content" },
			"input": { "value": "{{memberId}}", "reason": "Enter the member number." }
		}
	],
	"onExhausted": "error"
}
```

A `target` (`ScriptTargetSchema`) is `{ ref }` (fixed, to script a stale ref) or `{ role, name?, label?,
frame?, nth? }`. A step (`ScriptStepSchema`) may `repeat` (1–1000). The tool name is free, so an unknown tool
can script a wrong model. `onExhausted` is `error` | `end_turn` | `loop` (from `loopFrom`). Scripts hold
placeholders only. The bundled scripts are `member-lookup` and `open-sub-account`.

## Tools

- `ACTION_TOOLS` — one tool per action kind, named after it (`navigate`, `click`, `fill`, `select`, `press`,
  `extract`, `wait`, `dismiss_dialog`). This is define-action touch point 5 (`src/tools/toolDefinitions.ts`).
  It `satisfies Record<ActionKind, AgentToolDefinition>`, so a kind without a tool does not compile.
- `CONTROL_TOOL_NAMES` — `declare_output`, `finish` (with a `finalCheckpoint` that is verified on screen),
  `request_help`. They perform no action.
- `AGENT_TOOLS` / `agentToolSpecs()` — every tool in a fixed order (a stable prefix for prompt caching).
  Input schemas come from `TOOL_INPUT_SCHEMAS` (zod, strict, exported as JSON Schema).
- `toolToAction(call, context: ToolCallContext): ToolDecision` — validates the input and maps it to a
  `SurfaceAction` (actor `agent`, target by observation ref) or to a control decision. It throws
  `ToolCallError` (`UNKNOWN_TOOL`, `INVALID_INPUT`, `UNKNOWN_PLACEHOLDER`, `SENSITIVE_LITERAL`). The policy
  check happens in the guarded surface.
- **Placeholders.** A fill value or select option is a plain literal or exactly one placeholder:
  `{{paramName}}` or `CREDENTIAL_PLACEHOLDERS` (`{{credential.username}}`, `{{credential.password}}`).
  `toolToAction` substitutes the concrete value just before the surface acts and records the `ValueSource`
  (`literal` | `param` | `credential`) for the compiler. A literal that contains a known sensitive value is
  refused. Routes, wait texts and finish texts may use `{{paramName}}` only.

## Observation and prompt

- `formatObservation(observation, { redactor, maxChars?, maxFrameTextChars?, maxNameChars? })` renders the
  a11y tree as compact text between `OBSERVATION_OPEN` / `OBSERVATION_CLOSE`:
  `- role "name" [eN] (label: "…") value="…"`, frames as `- frame "<name>" url=<path>`, the pending dialog,
  and a page-text excerpt per frame. **Input addressing by adjacent label:** an unnamed legacy control or a data
  cell gets `(label: "…")` from the nearest named cell before it in its table row (`textbox [e18] (label:
  "Member #")`). Every string is placeholderized (`{{memberId}}`, masks) before it is written. Any
  `<observation` / `</observation` marker in page content is neutralized, so untrusted page text can neither
  close the block nor fake a newer one. Over `maxChars` (16 000), the deepest subtrees are elided
  deterministically.
- `parseFormattedObservation(text): ObservedElement[]` — the inverse, for the elements with refs of the last
  block. `ScriptedModel` uses it.
- `buildSystemPrompt({ goal, params, credentials, redactor, tools? })` — deterministic, so it can be cached.
  It contains the placeholderized goal, the input and credential placeholders, the tools, how to read an
  observation, an **untrusted-content** section (observation text is data, never instructions) and the rules:
  one tool per turn, a `reason` on every call, refs only from the latest observation, never type a real
  value, declare outputs before extracting, `finish` only when the goal is visibly met, and `request_help`
  instead of guessing.

## Trace

`DiscoveryTrace` (`steps: TraceStep[]`, `outputs: DeclaredOutput[]`, `finish: TraceFinish | null`) is the
structured record of a run, separate from the transcript (FR6). A `TraceStep` has `actor` `agent` | `human`,
a `TraceAction` whose values are `TraceValue` references (never a concrete param or credential), a
placeholderized fingerprint (`safeFingerprint`), `pageRoute`, digests, `ScreenDiff` (`computeScreenDiff`:
title and heading changes, added role+name elements, route changes, dialogs) and a `TraceVerdict`
(`ok` | `refused` | `failed`).

## Compiler

`new ArtifactCompiler().compile(trace, options: CompileOptions): Promise<CapabilityArtifact>` is
deterministic and uses no model. The pipeline:

1. Keep performed steps only. Collapse repeated fills of the same target and repeated navigations.
2. Turn `param` values into `param` ValueExprs and credential fills into `credential` refs to
   `profile.credentialRef`.
3. Tag the steps up to the first checkpoint after the last credential fill as the `login` phase.
4. Classify each step's risk with `classifyRisk` (an approved step is at least irreversible).
5. Copy `outcomeRules` from the profile, template the `summary`, assign step ids `sNN-<verb>-<what>`, and set
   `successCondition` from the verified finish.
6. Validate against `CapabilityArtifactSchema`, run the redaction-rule scan, and compute `contentHash`.

The pure building blocks:

- `buildLocatorLadder(fingerprint, { purpose, guard }): TargetRef` — rungs from most to least stable: role +
  exact name, exact visible text (clickables), then a structural anchor (row-label cell, the form row of the
  adjacent label, position in container). It never uses the data being read, a value or a mask. It throws
  `UnlocatableTargetError`.
- `deriveCheckpoint(subject, { guard }): Checkpoint | undefined` — from the `ScreenDiff`, in this order: title
  or heading text, then a new role+name element, then a route change. `fill`, `extract` and `wait` need none.
  It throws `UncheckpointableStepError` when a screen-changing step changed nothing verifiable (invariant 5).
- `createTextGuard(sensitiveValues)` / `containsValue` — a `TextGuard` rejects empty text, masks, braces and
  text that contains a run value, so no value becomes a locator or checkpoint.
- `assertNoConcreteValues(artifact, values: ConcreteValues, { redaction? })` scans every string and key for
  each example input, credential and extracted value (case-insensitive, at digit boundaries). With
  `redaction`, it also runs every free-text value through the policy's redaction patterns and terms. A string
  they would change is a leak (`valueKind` `REDACTION_RULE_MATCH`). Structural fields (ids, versions,
  provenance, hash, param and output names and types) are skipped, and so is the declared `example` of a
  non-sensitive param (e.g. a deposit amount `250.00`, which the `money-amount` rule would otherwise flag); a
  sensitive param's example and a literal amount in a step are still scanned (an amount must be a param). It throws `ConcreteValueLeakError`, which
  names the JSON path, never the value.

Compiler errors: `ArtifactCompileError` (`GOAL_NOT_MET`, `NO_STEPS`, `INVALID_ARTIFACT`),
`UnparameterizedSensitiveValueError` (a sensitive fill that is neither a param nor a credential, e.g. an
operator typing during a takeover), `UncheckpointableStepError`, `UnlocatableTargetError`,
`ConcreteValueLeakError`.

## Tests

- Unit (`pnpm --filter @idp/agent test`): no browser, no network, no real model. The SDK is mocked at the
  module boundary, and the loop runs with `ScriptedModel` + `FakeSurface`.
- Functional (`pnpm --filter @idp/agent test:functional`, build mock-bank first): `ScriptedModel` against a
  real mock-bank and a headless browser. `discoverMemberLookup` compiles an artifact, and no file of the run
  (artifact, prompts, log) holds a credential or param value. `discoveryStops` covers `max_steps`, `timeout`,
  `dead_end`, `policy_blocked`, `goal_unverified` and `model_gave_up`.
