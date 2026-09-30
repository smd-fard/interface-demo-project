import { z } from 'zod';

const URL_ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const ENV_TOKEN = /^\$\{[A-Z][A-Z0-9_]*\}$/;

export const OriginSchema = z
	.string()
	.max(300)
	.refine((origin) => URL_ORIGIN.test(origin) || ENV_TOKEN.test(origin), {
		message: 'origin must be a URL origin (scheme://host[:port], no path) or an ${ENV_VAR} token',
	})
	.describe(
		'A URL origin such as "http://127.0.0.1:4010" (scheme://host[:port], no path), or an environment token such as "${MOCKBANK_ORIGIN}" that the loader expands before use.',
	);
export type Origin = z.infer<typeof OriginSchema>;
