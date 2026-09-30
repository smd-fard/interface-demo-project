// Evidence driver for the AC11 human-takeover scenario (R6.2–R6.4). Throwaway: it lives outside the repo.
//
// Why a script and not `idp replay --attended` + a separate operator process: the CLI launches its own
// Playwright browser and exposes no remote-debugging / CDP hook, so nothing outside the CLI process can put
// real input events into that browser. This script therefore composes the CLI's own building blocks (the
// same modules `idp replay` runs: loadConfig, loadArtifactFile, EnvCredentialProvider, runReplay,
// writeControlFiles/removeControlFiles) and, in the same process, plays the operator:
//   - control plane: the REAL localhost control API over HTTP (ControlClient), with the URL and bearer token
//     read back from <run dir>/control.json and control.token exactly as `idp operator` does;
//   - the "human" fix: SimulatedOperator from @idp/surface/testing, which issues real mouse/keyboard events
//     (page.mouse / page.keyboard) into the session's own browser, so the session's human-action recorder
//     captures them like a person's gestures. No person was at the keyboard.
//
// Inputs come from the env (never literals): IDP_DEMO_MEMBER_ID, MOCKBANK_OPERATOR_USER,
// MOCKBANK_OPERATOR_PASSWORD, MOCKBANK_ORIGIN, IDP_CONTROL_PORT, IDP_RUNS_ROOT. The repo root is REPO.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const REPO = process.env.REPO ?? '/Users/mos/Workspaces/interface-demo-project';
const cli = (p) => path.join(REPO, 'apps/cli/dist', p);
const { loadConfig } = await import(cli('config/loadConfig.js'));
const { loadArtifactFile } = await import(cli('replay/loadArtifactFile.js'));
const { EnvCredentialProvider } = await import(cli('config/EnvCredentialProvider.js'));
const { runReplay } = await import(cli('replay/runReplay.js'));
const { writeControlFiles, removeControlFiles } = await import(cli('operator/writeControlFiles.js'));
const { controlPortFrom } = await import(cli('commands/controlPort.js'));
const { ControlClient } = await import(path.join(REPO, 'packages/session/dist/index.js'));
const { SimulatedOperator } = await import(path.join(REPO, 'packages/surface/dist/testing/index.js'));

const env = process.env;
const memberId = env.IDP_DEMO_MEMBER_ID;
if (!memberId) throw new Error('set IDP_DEMO_MEMBER_ID');
const OPERATOR = 'ops-1';
const content = [{ kind: 'by_name', name: 'content' }];
const nav = [{ kind: 'by_name', name: 'nav' }];
const rationale = 'evidence driver: the operator points at it';
const memberInput = {
	description: 'Member # input',
	frame: content,
	ladder: [{ kind: 'structural', anchor: { kind: 'form_row', labelText: 'Member #', control: 'input' }, rationale }],
};
const searchButton = {
	description: 'Search button',
	frame: content,
	ladder: [{ kind: 'role', role: 'button', name: 'Search', exact: true, rationale }],
};

async function until(probe, what, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await probe();
		if (value !== undefined) return value;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}
const exists = (file) => stat(file).then(() => true, () => false);

// Same wiring as `idp replay --attended` (apps/cli/src/commands/replay.ts).
const context = { repoRoot: REPO, invocationDir: REPO, env };
const config = await loadConfig({ ...context, profile: 'mock-bank' });
const { document, artifact } = await loadArtifactFile(path.join(REPO, 'artifacts/member-lookup.json'));
const credentials = new EnvCredentialProvider(env);
const sensitiveValues = credentials.knownValues(artifact.credentialRef);
await credentials.resolve(artifact.credentialRef);

let operatorTask = Promise.resolve();
let liveSession;
const run = await runReplay({
	document,
	artifact,
	params: { memberId },
	config,
	credentials,
	sensitiveValues,
	runsRoot: env.IDP_RUNS_ROOT,
	attended: true,
	headed: false,
	controlPort: controlPortFrom(env),
	onSessionOpen: async (session) => {
		const files = await writeControlFiles(session.runDir.path, {
			controlUrl: session.controlUrl,
			controlToken: session.controlToken,
		});
		console.log(`attended session: control API at ${files.controlUrl}; run dir ${session.runDir.path}`);
		liveSession = session;
		operatorTask = actAsOperator(session);
		operatorTask.catch((error) => console.error('operator failed:', error.message));
	},
	onSessionClosed: async (session) => removeControlFiles(session.runDir.path),
});

async function actAsOperator(session) {
	const runDir = session.runDir.path;
	// Like `idp operator`: find control.json, read the token file (never printed).
	const controlJson = path.join(runDir, 'control.json');
	await until(async () => ((await exists(controlJson)) ? true : undefined), 'control.json');
	const { controlUrl, tokenFile } = JSON.parse(await readFile(controlJson, 'utf8'));
	const token = (await readFile(tokenFile, 'utf8')).trim();
	const client = new ControlClient({ url: controlUrl, token });

	const request = await until(
		async () => (await client.interventions()).find((r) => r.kind === 'takeover' && r.status === 'open'),
		'the takeover request',
	);
	console.log(`operator: takeover request ${request.id} (${request.reason.code}) at step ${request.currentStep?.id}`);
	console.log(`operator: lease before claim = ${(await client.lease()).state}`);
	await client.claim(request.id, OPERATOR);
	console.log(`operator: claimed; lease = ${(await client.lease()).state}`);

	// The fix, with real input events in the session's own browser: back to Member Search from the nav menu,
	// re-enter the member number, click Search (the app_error fault was `once`, so Member Inquiry now shows).
	const operator = new SimulatedOperator(session.browser);
	await operator.click({ text: 'Member Search', frame: nav });
	await until(async () => {
		const check = await session.surface.check({ kind: 'text_present', text: 'Member #', frame: content }, {}, 2_000);
		return check.kind === 'held' ? true : undefined;
	}, 'the Member Search screen');
	await operator.type(memberInput, memberId);
	await operator.click(searchButton);
	await until(async () => {
		const check = await session.surface.check({ kind: 'text_present', text: 'Member Inquiry', frame: content }, {}, 2_000);
		return check.kind === 'held' ? true : undefined;
	}, 'the Member Inquiry screen');
	await until(() => (session.recordedHumanActions().length >= 3 ? true : undefined), 'three recorded actions');
	console.log(`operator: ${session.recordedHumanActions().length} human actions recorded; resuming`);
	await client.resume(OPERATOR);
}

await operatorTask;
const states = ['AGENT', ...liveSession.lease.history().map((t) => t.to)].filter((s) => s !== 'CLOSED');
console.log(`lease path: ${states.join(' → ')}`);
console.log(`result.kind = ${run.result.kind}`);
console.log(await readFile(path.join(run.runDir, 'result.json'), 'utf8'));
console.log(`run dir: ${run.runDir}`);
process.exit(run.result.kind === 'success' ? 0 : 1);
