const ENTITIES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

/**
 * Escapes a value for HTML text and (double- or single-quoted) attribute context. Every value the views
 * interpolate goes through this, so request text such as `<script>` renders inert.
 */
export function escapeHtml(value: string | number): string {
	return String(value).replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character);
}
