import { BindingMissingError } from '../errors/BindingMissingError.js';
import type { Bindings } from '../port/Bindings.js';

const PLACEHOLDER = /\{\{([a-z][a-zA-Z0-9]*)\}\}/g;

/** Replaces every `{{name}}` in a template with its binding. A placeholder without a binding throws. */
export function substituteTemplate(template: string, bindings: Bindings): string {
	return template.replace(PLACEHOLDER, (_match, name: string) => {
		const value = Object.hasOwn(bindings, name) ? bindings[name] : undefined;
		if (value === undefined) throw new BindingMissingError(name);
		return value;
	});
}
