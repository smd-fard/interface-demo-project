/** A response as the tests see it: status, final path, headers and body text. */
export interface Page {
	readonly status: number;
	readonly url: string;
	readonly location: string | null;
	readonly body: string;
}

/**
 * A minimal cookie-keeping HTTP client that behaves like one browser tab: it keeps the session cookie and
 * follows redirects (manually, so the cookie is carried).
 */
export class Teller {
	private cookie: string | null = null;

	constructor(private readonly baseUrl: string) {}

	get(pathname: string, options: { follow?: boolean } = {}): Promise<Page> {
		return this.request('GET', pathname, undefined, options.follow ?? true);
	}

	post(pathname: string, form: Record<string, string>, options: { follow?: boolean } = {}): Promise<Page> {
		return this.request('POST', pathname, new URLSearchParams(form).toString(), options.follow ?? true);
	}

	async signOn(user = 'teller01', password = 'synthetic-pass-01'): Promise<Page> {
		return this.post('/login', { txtUser: user, txtPwd: password });
	}

	private async request(method: string, pathname: string, body: string | undefined, follow: boolean): Promise<Page> {
		let url = new URL(pathname, this.baseUrl).toString();
		let currentMethod = method;
		let currentBody = body;
		for (let hop = 0; hop < 10; hop += 1) {
			const headers: Record<string, string> = {};
			if (this.cookie) headers.cookie = this.cookie;
			if (currentBody !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded';
			const response = await fetch(url, { method: currentMethod, headers, body: currentBody, redirect: 'manual' });
			const setCookie = response.headers.get('set-cookie');
			if (setCookie) this.cookie = setCookie.split(';')[0] ?? null;
			const location = response.headers.get('location');
			const text = await response.text();
			if (follow && location && response.status >= 300 && response.status < 400) {
				url = new URL(location, url).toString();
				currentMethod = 'GET';
				currentBody = undefined;
				continue;
			}
			return { status: response.status, url: new URL(url).pathname + new URL(url).search, location, body: text };
		}
		throw new Error(`too many redirects from ${pathname}`);
	}
}

/** The `<title>` text of a page. */
export function titleOf(body: string): string | undefined {
	return /<title>([^<]*)<\/title>/i.exec(body)?.[1];
}

/** Visible text with tags removed and whitespace collapsed (entities for & < > " decoded). */
export function textOf(body: string): string {
	return body
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The text of the leaf cell right of the leaf `<td>` whose text is exactly `header` (row header → value). */
export function cellRightOf(body: string, header: string): string | undefined {
	const leafCell = /<td[^>]*>((?:(?!<td|<table)[\s\S])*?)<\/td>/gi;
	const cells = [...body.matchAll(leafCell)].map((m) => textOf(m[1] ?? ''));
	const index = cells.findIndex((cell) => cell === header);
	return index >= 0 ? cells[index + 1] : undefined;
}
