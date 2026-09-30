/**
 * The placeholders the model types for the sign-on credentials. The system prompt lists them; `toolToAction`
 * substitutes the real value just before the surface acts, and the compiler turns them into `credential`
 * ValueExprs. The secret itself never reaches the model, a log or the artifact (invariant 3).
 */
export const CREDENTIAL_PLACEHOLDERS = Object.freeze({
	username: '{{credential.username}}',
	password: '{{credential.password}}',
} as const);

/** A sign-on credential field: `username` or `password`. */
export type CredentialField = keyof typeof CREDENTIAL_PLACEHOLDERS;
