# Unit test patterns

These are the conventions. Where a fake below doesn't exist yet, the first test that needs it creates it in the
owning package's `src/testing/` (exported from a `testing` subpath, never from the main barrel), and later
tests reuse it.

## Shared fakes (by owning package)

| Fake            | Package                 | Stands in for                        | Behaviour                                                                                   |
| --------------- | ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `FakeSurface`   | `@idp/surface`          | the `Surface` port                   | A scripted sequence of observations; records every `act()` call; can inject a condition or a throw on step N. |
| `ScriptedModel` | `@idp/agent`            | the LLM client                       | Returns a scripted list of tool calls / final answers; records prompts, so a test can assert the prompts contain no unredacted values. |
| `FakeClock`     | `@idp/evidence` (or whichever package the foundation spec picks) | time | `now()`, `advance(ms)`; used by waits, retries, lease timeouts.                              |
| `MemorySink`    | `@idp/evidence`         | log / evidence sinks                 | Collects structured events in memory; helpers to find by event type.                          |
| Fixtures        | `@idp/artifact-schema`  | example artifacts / results          | `fixtures/*.json`: valid by construction, validated in the schema tests.                       |

## Shape

```ts
import { beforeEach, describe, expect, it } from 'vitest';

describe('<Unit>', () => {
	let surface: FakeSurface;

	beforeEach(() => {
		surface = new FakeSurface([...observations]);
	});

	it('returns business_outcome member_not_found when the search shows no results', async () => {
		const result = await run(...);
		expect(result.kind).toBe('business_outcome');
		expect(result.code).toBe('member_not_found');
	});
});
```

- Test names state the behaviour and the expected contract variant, not the method name.
- One behaviour per `it`. Put the arrange step in `beforeEach` only when every case shares it.
- Parse outputs with the real schema (`RunResultSchema.parse(result)`), so a contract regression fails the test.
- Redaction assertions: serialize everything the sink received and assert the raw fixture values are absent
  (`expect(JSON.stringify(sink.events)).not.toContain('12345')` when `12345` was a param value).
- Use `vi.spyOn` only for boundaries that have no fake (e.g. `process.env`). Restore in `afterEach`.
