import type { z } from 'zod';
import { TemplateStringSchema } from './TemplateString.js';

export const RouteSchema = TemplateStringSchema.regex(/^\/(?!\/)/).describe(
	'A route relative to the app origin, starting with "/", e.g. "/member/detail?m={{memberId}}". The origin is supplied at run time by the app profile, so the same artifact runs against any environment of the app and never carries a host name.',
);
export type Route = z.infer<typeof RouteSchema>;
