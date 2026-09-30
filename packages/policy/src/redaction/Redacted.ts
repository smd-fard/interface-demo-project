declare const redactedBrand: unique symbol;

/**
 * A value that has passed through the redactor. Only `createRedactor` produces it, and the sinks in
 * `@idp/evidence` (run log, evidence store) accept only this type — a compile-time guard for invariant 3.
 * The brand exists only in the type system; at run time the value is the plain redacted copy.
 */
export type Redacted<T> = T & { readonly [redactedBrand]: true };
