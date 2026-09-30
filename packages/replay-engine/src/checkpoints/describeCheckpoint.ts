import type { Checkpoint } from '@idp/artifact-schema';

type Leaf = Exclude<Checkpoint, { kind: 'all_of' }>;

function frameOf(checkpoint: { readonly frame?: readonly { readonly kind: string }[] }): string {
	if (checkpoint.frame === undefined) return '';
	const hops = checkpoint.frame.map((hop) => ('name' in hop ? String(hop.name) : hop.kind));
	return ` in frame ${hops.join('/')}`;
}

function leaf(checkpoint: Leaf): string {
	switch (checkpoint.kind) {
		case 'element_visible':
			return `${checkpoint.target.description} visible`;
		case 'element_absent':
			return `${checkpoint.target.description} absent`;
		case 'text_present':
			return `text "${checkpoint.text}" present${frameOf(checkpoint)}`;
		case 'text_absent':
			return `text "${checkpoint.text}" absent${frameOf(checkpoint)}`;
		case 'url_matches':
			return `route matches "${checkpoint.route}"`;
		case 'title_matches':
			return `title ${checkpoint.match === 'exact' ? 'is' : 'contains'} "${checkpoint.title}"`;
	}
}

/**
 * A one-line description of a checkpoint for `expected` in a failure. Uses the artifact's template text
 * (`{{memberId}}`, not the value), so it carries no run-time data.
 */
export function describeCheckpoint(checkpoint: Checkpoint): string {
	if (checkpoint.kind === 'all_of') return `all of: ${checkpoint.checks.map(leaf).join('; ')}`;
	return leaf(checkpoint);
}
