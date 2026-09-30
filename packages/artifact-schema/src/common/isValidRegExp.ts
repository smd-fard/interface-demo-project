/** Whether `source` compiles as an ECMAScript regular expression. Pure. */
export function isValidRegExp(source: string): boolean {
	try {
		new RegExp(source);
		return true;
	} catch (error) {
		if (error instanceof SyntaxError) return false;
		throw error;
	}
}
