/**
 * Where a typed or selected value came from. The model writes a placeholder; the agent resolves it to the
 * concrete value for the surface and records the source, so the compiler emits a `param` or `credential`
 * ValueExpr and never the concrete value (invariant 3).
 */
export type ValueSource =
	| { readonly kind: 'literal' }
	| { readonly kind: 'param'; readonly name: string }
	| { readonly kind: 'credential'; readonly field: 'username' | 'password' };
