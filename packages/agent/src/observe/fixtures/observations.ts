import { buildA11yTree, type FrameSnapshot, type Observation } from '@idp/surface';
import loginSnapshot from './frameset-login.snapshot.json' with { type: 'json' };

// Synthetic mock-bank screens only (invariant 7): member 12345 "Jane Sample" is the seed record.

const DETAIL_CONTENT = [
	'- document:',
	'  - table:',
	'    - rowgroup:',
	'      - row "Member Inquiry":',
	'        - cell "Member Inquiry":',
	'          - heading "Member Inquiry" [level=3]',
	'      - row "Member # 12345":',
	'        - cell "Member #"',
	'        - cell "12345"',
	'      - row "Member Name Jane Sample":',
	'        - cell "Member Name"',
	'        - cell "Jane Sample"',
	'      - row "Checking 842.10":',
	'        - cell "Checking"',
	'        - cell "842.10"',
	'      - row "Share Savings 1523.47 8800123450":',
	'        - cell "Share Savings"',
	'        - cell "1523.47"',
	'        - cell "8800123450"',
	'  - link "Open Sub-Account":',
	'    - /url: /subaccount/open?m=12345',
].join('\n');

function frameInfo(path: readonly string[], url: string, title: string, text: string) {
	return { path, name: path.at(-1) ?? '', url, title, status: 200, text, textTruncated: false };
}

function observation(frames: readonly FrameSnapshot[], contentUrl: string, contentText: string): Observation {
	return {
		url: 'http://127.0.0.1:4010/',
		title: 'CoreOne',
		frames: [
			frameInfo([], 'http://127.0.0.1:4010/', 'CoreOne', ''),
			frameInfo(['banner'], 'http://127.0.0.1:4010/banner', '', 'CoreOne 7.4'),
			frameInfo(['nav'], 'http://127.0.0.1:4010/nav', '', 'Member Search Sign Off'),
			frameInfo(['content'], contentUrl, '', contentText),
		],
		tree: buildA11yTree(frames).tree,
		pendingDialog: null,
		lastNavigation: null,
		digest: 'd',
	};
}

/** The frameset with the Sign On form in the content frame; the User ID box already holds `teller01`. */
export function loginObservation(): Observation {
	return observation(
		(loginSnapshot as { frames: FrameSnapshot[] }).frames,
		'http://127.0.0.1:4010/login',
		'Sign On User ID Password Sign On Need help? Help',
	);
}

/** The frameset with Member Inquiry for member 12345 in the content frame (balances: Checking 842.10, Share Savings 1523.47). */
export function detailObservation(): Observation {
	const frames = (loginSnapshot as { frames: FrameSnapshot[] }).frames.map((frame) =>
		frame.path[0] === 'content' ? { ...frame, yaml: DETAIL_CONTENT } : frame,
	);
	return observation(
		frames,
		'http://127.0.0.1:4010/member/detail?m=12345',
		'Member Inquiry Member # 12345 Member Name Jane Sample Checking 842.10 Share Savings 1523.47 8800123450 Open Sub-Account',
	);
}
