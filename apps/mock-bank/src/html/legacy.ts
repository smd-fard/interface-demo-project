/**
 * Legacy markup helpers. They deliberately produce what a 2000s-era core-banking screen looks like: layout
 * tables nested three or more deep, labels in the adjacent `<td>` (never `<label for>`), generic control
 * names (`txt1`, `btnGo`), `<font>` tags and no ids, test ids or ARIA of any kind.
 */

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML element content and double-quoted attribute values. */
export function esc(value: string): string {
	return value.replace(/[&<>"']/g, (ch) => ENTITIES[ch] ?? ch);
}

/** A complete HTML 4.01 Transitional document. `body` is trusted markup built by these helpers. */
export function page(options: { title: string; body: string; bgcolor?: string; script?: string }): string {
	const script = options.script === undefined ? '' : `\n<script>${options.script}</script>`;
	return [
		'<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">',
		'<html>',
		'<head>',
		'<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
		`<title>${esc(options.title)}</title>`,
		'</head>',
		`<body bgcolor="${options.bgcolor ?? '#FFFFFF'}" leftmargin="0" topmargin="0">`,
		options.body,
		`${script}`,
		'</body>',
		'</html>',
	].join('\n');
}

/** Wraps markup in `depth` nested full-width layout tables (a single cell each). */
export function nest(inner: string, depth = 3): string {
	let html = inner;
	for (let level = 0; level < depth; level += 1) {
		html = `<table width="100%" border="0" cellpadding="${level === depth - 1 ? 4 : 0}" cellspacing="0"><tr><td valign="top">\n${html}\n</td></tr></table>`;
	}
	return html;
}

/** A grid table of rows (each a `<tr>…</tr>`). */
export function grid(rows: readonly string[], options: { border?: number; width?: string } = {}): string {
	return `<table border="${options.border ?? 0}" cellpadding="3" cellspacing="0" width="${options.width ?? '100%'}">\n${rows.join('\n')}\n</table>`;
}

/** A form row: the label text in one cell, the control in the adjacent cell. */
export function formRow(label: string, control: string): string {
	return `<tr><td width="140" nowrap>${esc(label)}</td><td>${control}</td></tr>`;
}

/** A data row: a header cell and one or more value cells (all plain text). */
export function dataRow(header: string, ...values: string[]): string {
	return `<tr><td bgcolor="#E8E8E8">${esc(header)}</td>${values.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`;
}

/** A row spanning the grid, holding arbitrary trusted markup. */
export function spanRow(markup: string, colspan = 2): string {
	return `<tr><td colspan="${colspan}">${markup}</td></tr>`;
}

/** A plain text input with a generic name. */
export function textInput(name: string, options: { value?: string; size?: number } = {}): string {
	return `<input type="text" name="${esc(name)}" size="${options.size ?? 20}" value="${esc(options.value ?? '')}">`;
}

/** A password input with a generic name. */
export function passwordInput(name: string): string {
	return `<input type="password" name="${esc(name)}" size="20" value="">`;
}

/** A submit button: role button, accessible name = `value`. `onclick` is a trusted inline handler. */
export function submit(name: string, value: string, onclick?: string): string {
	const handler = onclick === undefined ? '' : ` onclick="${onclick}"`;
	return `<input type="submit" name="${esc(name)}" value="${esc(value)}"${handler}>`;
}

/** A dropdown with plain `<option>` elements (the option text is also its value). */
export function select(name: string, options: readonly string[], selected?: string): string {
	const items = options.map((o) =>
		o === selected ? `<option selected>${esc(o)}</option>` : `<option>${esc(o)}</option>`,
	);
	return `<select name="${esc(name)}">${items.join('')}</select>`;
}

/** A screen heading, the legacy way: bold `<font>`, not an `<h1>`. */
export function heading(text: string): string {
	return `<font face="Arial" size="4" color="#003366"><b>${esc(text)}</b></font>`;
}

/** A server-rendered red message, the legacy way. */
export function redMessage(text: string): string {
	return `<font color="red">${esc(text)}</font>`;
}

/** A plain link. `target` names a frame. */
export function link(href: string, text: string, target?: string): string {
	const t = target === undefined ? '' : ` target="${esc(target)}"`;
	return `<a href="${esc(href)}"${t}>${esc(text)}</a>`;
}
