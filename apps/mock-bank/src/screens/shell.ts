import { nest, page } from '../html/legacy.js';

/**
 * A content-frame screen: title `CoreOne - <screen>`, body wrapped in three layout tables, plus an optional
 * inline script (the legacy dialogs).
 */
export function contentScreen(screen: string, inner: string, script?: string): string {
	return page({
		title: `CoreOne - ${screen}`,
		bgcolor: '#F4F4EC',
		body: nest(inner, 3),
		...(script === undefined ? {} : { script }),
	});
}
