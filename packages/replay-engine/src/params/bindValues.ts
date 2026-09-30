import type { ParamValues, ValueExpr } from '@idp/artifact-schema';
import type { Redactor } from '@idp/policy';
import type { Bindings } from '@idp/surface';
import { ReplayError } from '../errors/ReplayError.js';
import type { Credential } from './Credential.js';
import type { CredentialProvider } from './CredentialProvider.js';

/** Resolves step values for one run. */
export interface ValueBinder {
	/** `{{placeholder}}` bindings for routes, target ladders and checkpoint text: the params as strings. */
	readonly bindings: Bindings;
	/**
	 * The concrete value of a ValueExpr: a param from the validated params, a literal as-is, or a credential
	 * field through the `CredentialProvider` (resolved once per ref and added to the redactor at once).
	 */
	value(expr: ValueExpr): Promise<string>;
}

/** The validated params, the credential port and the redactor a `ValueBinder` seeds. */
export interface ValueBinderOptions {
	readonly params: ParamValues;
	readonly credentials: CredentialProvider;
	/** The run's redactor: every resolved credential field is added to its known sensitive values. */
	readonly redactor: Redactor;
}

/** The params as template bindings (numbers and booleans as their string form). */
export function paramBindings(params: ParamValues): Bindings {
	const bindings: Record<string, string> = {};
	for (const [name, value] of Object.entries(params)) bindings[name] = String(value);
	return bindings;
}

/** A value binder over validated params and a credential provider. */
export function createValueBinder(options: ValueBinderOptions): ValueBinder {
	const resolved = new Map<string, Promise<Credential>>();
	const credential = (ref: string): Promise<Credential> => {
		let pending = resolved.get(ref);
		if (pending === undefined) {
			pending = options.credentials.resolve(ref).then((found) => {
				// Seed the redactor before the value is used anywhere (invariant 3).
				options.redactor.addSensitiveValue(found.username);
				options.redactor.addSensitiveValue(found.password);
				return found;
			});
			resolved.set(ref, pending);
		}
		return pending;
	};
	return {
		bindings: paramBindings(options.params),
		async value(expr) {
			switch (expr.kind) {
				case 'literal':
					return expr.value;
				case 'param': {
					const value = options.params[expr.name];
					if (value === undefined) {
						throw new ReplayError('invalid_params', {
							step: null,
							expected: `a value for param "${expr.name}"`,
							observed: `param "${expr.name}" was not supplied`,
						});
					}
					return String(value);
				}
				case 'credential':
					return (await credential(expr.ref))[expr.field];
			}
		},
	};
}
