import type { ConditionSignature } from '@idp/artifact-schema';
import type { FrameInfo, Observation } from '@idp/surface';
import { fakeObservation } from '@idp/surface/testing';
import { describe, expect, it } from 'vitest';
import { detectConditions, matchSignature } from './detectConditions.js';
import type { ResolvedRule } from './resolveRules.js';

const ORIGIN = 'http://127.0.0.1:4010';
const content = [{ kind: 'by_name' as const, name: 'content' }];

function frame(path: string[], overrides: Partial<FrameInfo> = {}): FrameInfo {
	return {
		path,
		name: path.at(-1) ?? '',
		url: `${ORIGIN}/${path.join('/')}`,
		title: '',
		status: 200,
		text: '',
		textTruncated: false,
		...overrides,
	};
}

/** A frameset: the top document, a nav frame and the content frame. */
function screen(content: Partial<FrameInfo>, overrides: Partial<Observation> = {}): Observation {
	return fakeObservation(`${ORIGIN}/`, {
		title: 'CoreOne 7.4',
		frames: [
			frame([], { url: `${ORIGIN}/`, title: 'CoreOne 7.4' }),
			frame(['nav'], { url: `${ORIGIN}/nav`, title: 'Menu', text: 'Member Search About CoreOne Sign Off' }),
			frame(['content'], { url: `${ORIGIN}/member/search`, title: 'CoreOne - Member Search', ...content }),
		],
		...overrides,
	});
}

const rule = (code: string, signature: ConditionSignature, cls: ResolvedRule['class'] = 'business_outcome') =>
	({ code, class: cls, description: code, signature, source: 'artifact' }) satisfies ResolvedRule;

describe('matchSignature', () => {
	it('text_present: a normalized, case-sensitive substring of any frame text; returns the signature text', () => {
		const obs = screen({ text: 'Member Search Member # No records  match your search criteria' });
		const sig: ConditionSignature = { kind: 'text_present', text: 'No records match your search criteria' };
		expect(matchSignature(sig, obs)).toBe('No records match your search criteria');
		expect(matchSignature({ kind: 'text_present', text: 'no records match' }, obs)).toBeNull();
	});

	it('text_present with a frame scope looks only in that frame', () => {
		const obs = screen({ text: 'Member Search' });
		expect(matchSignature({ kind: 'text_present', text: 'Sign Off', frame: content }, obs)).toBeNull();
		expect(matchSignature({ kind: 'text_present', text: 'Sign Off' }, obs)).toBe('Sign Off');
		expect(
			matchSignature({ kind: 'text_present', text: 'Sign Off', frame: [{ kind: 'by_name', name: 'nav' }] }, obs),
		).toBe('Sign Off');
		expect(
			matchSignature(
				{ kind: 'text_present', text: 'Member Search', frame: [{ kind: 'by_url_path', glob: '**/member/*' }] },
				obs,
			),
		).toBe('Member Search');
		expect(
			matchSignature(
				{ kind: 'text_present', text: 'Member Search', frame: [{ kind: 'by_title', title: 'Menu' }] },
				obs,
			),
		).toBe('Member Search');
	});

	it('title_matches: the top title or any frame title; with a frame, only that frame', () => {
		const obs = screen({ title: 'Server Error', text: 'Runtime Error — ORA-06512' });
		expect(matchSignature({ kind: 'title_matches', title: 'Server Error' }, obs)).toBe('Server Error');
		expect(matchSignature({ kind: 'title_matches', title: 'Server Error', frame: content }, obs)).toBe('Server Error');
		expect(
			matchSignature({ kind: 'title_matches', title: 'Server Error', frame: [{ kind: 'by_name', name: 'nav' }] }, obs),
		).toBeNull();
	});

	it('route_matches: a glob over each frame route (path, or path with query)', () => {
		const obs = screen({ url: `${ORIGIN}/login?reason=expired` });
		expect(matchSignature({ kind: 'route_matches', route: '**/login*' }, obs)).toBe('**/login*');
		expect(matchSignature({ kind: 'route_matches', route: '/login' }, obs)).toBe('/login');
		expect(matchSignature({ kind: 'route_matches', route: '/subaccount/*' }, obs)).toBeNull();
	});

	it('dialog_text: over the pending native dialog message', () => {
		const obs = screen({}, { pendingDialog: { type: 'alert', message: 'Scheduled  maintenance tonight at 11 PM' } });
		expect(matchSignature({ kind: 'dialog_text', text: 'Scheduled maintenance' }, obs)).toBe('Scheduled maintenance');
		expect(matchSignature({ kind: 'dialog_text', text: 'Printer' }, obs)).toBeNull();
		expect(matchSignature({ kind: 'dialog_text', text: 'Scheduled maintenance' }, screen({}))).toBeNull();
	});

	it('http_status: over the last document load', () => {
		const load = (status: number | null) =>
			screen({}, { lastNavigation: { framePath: ['content'], url: `${ORIGIN}/member/detail`, status, durationMs: 5 } });
		const sig: ConditionSignature = { kind: 'http_status', min: 500, max: 599 };
		expect(matchSignature(sig, load(503))).toBe('HTTP 503');
		expect(matchSignature(sig, load(200))).toBeNull();
		expect(matchSignature(sig, load(null))).toBeNull();
		expect(matchSignature(sig, screen({}))).toBeNull();
	});

	it('any_of: the first leaf that matches', () => {
		const sig: ConditionSignature = {
			kind: 'any_of',
			signatures: [
				{ kind: 'title_matches', title: 'Server Error' },
				{ kind: 'text_present', text: 'Runtime Error' },
			],
		};
		expect(matchSignature(sig, screen({ text: 'Runtime Error — ORA-06512' }))).toBe('Runtime Error');
		expect(matchSignature(sig, screen({ text: 'Member Search' }))).toBeNull();
	});
});

describe('detectConditions', () => {
	const notFound = rule('member_not_found', {
		kind: 'text_present',
		text: 'No records match your search criteria',
		frame: content,
	});
	const denied = rule('permission_denied', { kind: 'text_present', text: 'SEC-403' });

	it('returns the first rule (in resolution order) whose signature matches, with the matched signature text', () => {
		const obs = screen({ text: 'You are not authorized for this function (SEC-403)' });
		expect(detectConditions([notFound, denied], obs)).toEqual({
			code: 'permission_denied',
			rule: denied,
			matchedText: 'SEC-403',
		});
	});

	it('returns null when nothing matches or there are no rules', () => {
		expect(detectConditions([notFound, denied], screen({ text: 'Member Inquiry' }))).toBeNull();
		expect(detectConditions([], screen({ text: 'SEC-403' }))).toBeNull();
	});

	it('never returns observed screen text (only the signature text), so a match carries no member data', () => {
		const obs = screen({ text: 'No records match your search criteria for member 99999' });
		const match = detectConditions([notFound], obs);
		expect(match?.matchedText).toBe('No records match your search criteria');
		expect(JSON.stringify(match)).not.toContain('99999');
	});
});
