/** Thrown when `layers.json` cannot be read or does not match the layer-model shape. */
export class LayersConfigError extends Error {
	readonly code = 'LAYERS_CONFIG_INVALID' as const;

	/** The offending key or path inside `layers.json` (e.g. `layers[1][0]`), or `(file)` for read/parse errors. */
	readonly key: string;

	constructor(key: string, detail: string, options?: ErrorOptions) {
		super(`layers.json invalid at "${key}": ${detail}`, options);
		this.name = 'LayersConfigError';
		this.key = key;
	}
}
