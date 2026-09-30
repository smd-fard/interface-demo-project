import { findMember } from '../data/members.js';
import { sendHtml } from '../http/respond.js';
import { memberDetailScreen, type DetailDialog } from '../screens/memberDetail.js';
import { accountSummaryScreen } from '../screens/accountSummary.js';
import { LATE_RENDER_DEFAULT_MS, memberSearchScreen } from '../screens/memberSearch.js';
import type { ContentContext, Route } from './Route.js';

const MEMBER_NUMBER = /^\d{5}$/;

/** Member Search (`GET /member/search`) and Member Inquiry (`GET /member/detail?m=` or `?txt1=`). */
export const memberRoutes: readonly Route[] = [
	{
		kind: 'content',
		method: 'GET',
		path: '/member/search',
		handle: ({ res, url, app }) => {
			const withoutButton = app.faults.take('control_missing', url.pathname) !== undefined;
			const late = withoutButton ? undefined : app.faults.take('late_render', url.pathname);
			sendHtml(
				res,
				200,
				memberSearchScreen(app.tenant, {
					withoutButton,
					...(late === undefined ? {} : { lateButtonMs: late.delayMs ?? LATE_RENDER_DEFAULT_MS }),
				}),
			);
		},
	},
	{ kind: 'content', method: 'GET', path: '/member/detail', handle: memberDetail },
];

function memberDetail({ res, url, app }: ContentContext): void {
	const path = url.pathname;
	const value = (url.searchParams.get('m') ?? url.searchParams.get('txt1') ?? '').trim();
	const research = (message: 'invalidMemberNumber' | 'noRecords'): void =>
		sendHtml(res, 200, memberSearchScreen(app.tenant, { message, value }));

	if (app.faults.take('validation_error', path) || !MEMBER_NUMBER.test(value)) {
		research('invalidMemberNumber');
		return;
	}
	if (app.faults.take('wrong_screen', path)) {
		sendHtml(res, 200, accountSummaryScreen());
		return;
	}
	const member = app.faults.take('member_not_found', path) ? undefined : findMember(value);
	if (!member) {
		research('noRecords');
		return;
	}
	let dialog: DetailDialog | undefined;
	if (app.faults.take('known_dialog', path)) dialog = 'known';
	else if (app.faults.take('unknown_dialog', path)) dialog = 'unknown';
	sendHtml(res, 200, memberDetailScreen(app.tenant, member, dialog));
}
