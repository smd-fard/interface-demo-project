# artifacts/

The capability catalog: compiled, versioned capability artifacts (`CapabilityArtifact`, schema
`packages/artifact-schema/schemas/CapabilityArtifact.schema.json`). `pnpm idp catalog` lists them, and
`pnpm idp replay --artifact artifacts/<id>.json --param …` runs one deterministically, with no LLM.

## How artifacts get here

- `pnpm idp discover … --out artifacts/<id>.json` compiles a successful discovery run into an artifact. It
  replays the new artifact once with the example inputs first (`--verify-replay`, on by default) and writes it
  only if that replay succeeds.
- `member-lookup.json` is the artifact compiled by the real discovery run (`claude-sonnet-5-5`,
  member-lookup v1.0.0). `provenance.discoveryRunId` names that run; its evidence is in
  [`evidence/discovery-member-lookup/`](../evidence/discovery-member-lookup/). Its `memberId` param is a plain
  `string` with no pattern (as `discover` derives it), so a malformed id is rejected by the app
  (`validation_rejected`), not up front. The hand-written reference fixture it replaced (v1.0.1, with a
  `^\d{5}$` pattern and a `memberName` output) stays at
  `packages/artifact-schema/fixtures/member-lookup.artifact.json`.
- `open-sub-account.json` is a copy of the hand-written fixture
  `packages/artifact-schema/fixtures/open-sub-account.artifact.json`.

Artifacts hold parameter references (`{{memberId}}`) and a credential reference (`mockbank-operator`), never
concrete sensitive values. Any edit changes the content hash, and `pnpm idp catalog --verify` reports the
mismatch.
