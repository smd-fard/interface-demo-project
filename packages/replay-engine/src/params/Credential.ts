/** A credential resolved at run time. Both fields are secrets: seed the redactor before any use. */
export interface Credential {
	readonly username: string;
	readonly password: string;
}
