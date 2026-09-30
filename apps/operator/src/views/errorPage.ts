import { escapeHtml } from './escapeHtml.js';

/** A standalone error page (no script): the status, a stable code and a short message. */
export function errorPage(status: number, code: string, message: string): string {
	return [
		'<!doctype html>',
		'<html lang="en">',
		'<head><meta charset="utf-8"><title>Operator console error</title></head>',
		'<body>',
		`<h1>${escapeHtml(status)} <code>${escapeHtml(code)}</code></h1>`,
		`<p>${escapeHtml(message)}</p>`,
		'<p><a href="/">Back to the console</a></p>',
		'</body>',
		'</html>',
	].join('\n');
}
