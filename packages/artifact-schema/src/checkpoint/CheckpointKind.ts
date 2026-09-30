import { z } from 'zod';

/** The kinds of the Checkpoint union, for the run log's checkpoint entries. */
export const CHECKPOINT_KINDS = [
	'element_visible',
	'element_absent',
	'text_present',
	'text_absent',
	'url_matches',
	'title_matches',
	'all_of',
] as const;

export const CheckpointKindSchema = z.enum(CHECKPOINT_KINDS).describe('The kind of a checkpoint.');
export type CheckpointKind = z.infer<typeof CheckpointKindSchema>;
