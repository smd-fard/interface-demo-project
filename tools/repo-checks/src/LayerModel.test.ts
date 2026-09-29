import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadLayerModel } from './LayerModel.js';
import { LayersConfigError } from './LayersConfigError.js';

const realLayersPath = fileURLToPath(new URL('../layers.json', import.meta.url));

function realConfig(): Record<string, unknown> {
	return JSON.parse(readFileSync(realLayersPath, 'utf8')) as Record<string, unknown>;
}

describe('loadLayerModel', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'repo-checks-layers-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function write(config: unknown): string {
		const path = join(dir, 'layers.json');
		writeFileSync(path, typeof config === 'string' ? config : JSON.stringify(config));
		return path;
	}

	function expectInvalid(config: unknown, keyFragment: string): void {
		const path = write(config);
		let caught: unknown;
		try {
			loadLayerModel(path);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(LayersConfigError);
		const error = caught as LayersConfigError;
		expect(error.code).toBe('LAYERS_CONFIG_INVALID');
		expect(error.message).toContain(keyFragment);
	}

	it('loads the real layers.json (ignoring $comment)', () => {
		const model = loadLayerModel(realLayersPath);
		expect(model.layers[0]).toEqual(['@idp/artifact-schema']);
		expect(model.layers).toHaveLength(7);
		expect(model.isolated).toEqual(['@idp/mock-bank']);
		expect(model.tooling).toContain('@idp/repo-checks');
		expect(model.owners['playwright']).toBe('@idp/surface');
		expect(model.owners['@anthropic-ai/sdk']).toBe('@idp/agent');
		expect(model.runtimeAllowlist['@idp/artifact-schema']).toEqual(['zod']);
		expect(model.forbiddenReach).toContainEqual({ from: '@idp/replay-engine', to: '@idp/agent' });
		expect(Object.keys(model)).not.toContain('$comment');
	});

	it('throws on a model missing layers', () => {
		const config = realConfig();
		delete config['layers'];
		expectInvalid(config, 'layers');
	});

	it('throws on a name without the @idp/ scope', () => {
		const config = realConfig();
		config['layers'] = [['@idp/artifact-schema'], ['policy']];
		expectInvalid(config, 'policy');
	});

	it('throws on a name in two ranks', () => {
		const config = realConfig();
		const layers = config['layers'] as string[][];
		layers[1] = ['@idp/policy', '@idp/artifact-schema'];
		expectInvalid(config, '@idp/artifact-schema');
	});

	it('throws on a name in two groups (layers and tooling)', () => {
		const config = realConfig();
		config['tooling'] = ['@idp/typescript-config', '@idp/repo-checks', '@idp/policy'];
		expectInvalid(config, '@idp/policy');
	});

	it('throws on an owner that is not a known workspace', () => {
		const config = realConfig();
		config['owners'] = { playwright: '@idp/nope' };
		expectInvalid(config, '@idp/nope');
	});

	it('throws on a runtimeAllowlist key that is not a known workspace', () => {
		const config = realConfig();
		config['runtimeAllowlist'] = { '@idp/ghost': ['zod'] };
		expectInvalid(config, '@idp/ghost');
	});

	it('throws on a forbiddenReach.from that is not a known workspace', () => {
		const config = realConfig();
		config['forbiddenReach'] = [{ from: '@idp/phantom', to: '@idp/agent' }];
		expectInvalid(config, '@idp/phantom');
	});

	it('throws on an unknown top-level key', () => {
		const config = realConfig();
		config['extra'] = true;
		expectInvalid(config, 'extra');
	});

	it('throws on invalid JSON', () => {
		expectInvalid('{ "layers": [', 'JSON');
	});

	it('throws on an unreadable file', () => {
		let caught: unknown;
		try {
			loadLayerModel(join(dir, 'missing.json'));
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(LayersConfigError);
		expect((caught as LayersConfigError).code).toBe('LAYERS_CONFIG_INVALID');
	});
});
