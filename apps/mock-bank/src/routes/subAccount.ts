import { findMember, type Member } from '../data/members.js';
import { PRODUCTS, type PendingSubAccount, type Product } from '../data/SubAccountLedger.js';
import { readForm } from '../http/request.js';
import { redirect, sendHtml } from '../http/respond.js';
import { confirmSubAccountScreen } from '../screens/confirmSubAccount.js';
import { permissionDeniedScreen } from '../screens/errors.js';
import { memberSearchScreen } from '../screens/memberSearch.js';
import type { MessageKey } from '../screens/messages.js';
import { openSubAccountScreen } from '../screens/openSubAccount.js';
import { subAccountOpenedScreen } from '../screens/subAccountOpened.js';
import type { ContentContext, Route } from './Route.js';

const DEPOSIT = /^\d{1,7}(\.\d{1,2})?$/;

/**
 * The irreversible Open Sub-Account flow: form (`GET /subaccount/open?m=`) → review
 * (`POST /subaccount/confirm?m=`, pending request kept in the session) → commit (`POST /subaccount/opened`)
 * → confirmation (`GET /subaccount/opened`). Requires the `open_subaccount` entitlement.
 */
export const subAccountRoutes: readonly Route[] = [
	{ kind: 'content', method: 'GET', path: '/subaccount/open', handle: entitled(openForm) },
	{ kind: 'content', method: 'POST', path: '/subaccount/confirm', handle: entitled(review) },
	{ kind: 'content', method: 'POST', path: '/subaccount/opened', handle: entitled(commit) },
	{ kind: 'content', method: 'GET', path: '/subaccount/opened', handle: entitled(showOpened) },
];

function entitled(handler: (ctx: ContentContext) => Promise<void> | void) {
	return (ctx: ContentContext): Promise<void> | void => {
		if (!ctx.session.user.entitlements.includes('open_subaccount')) {
			sendHtml(ctx.res, 200, permissionDeniedScreen());
			return;
		}
		return handler(ctx);
	};
}

/** The member named by `?m=`, or renders "No records match" and returns undefined. */
function memberOrNoRecords({ res, url, app }: ContentContext): Member | undefined {
	const member = findMember(url.searchParams.get('m') ?? '');
	if (!member) sendHtml(res, 200, memberSearchScreen(app.tenant, { message: 'noRecords' }));
	return member;
}

function openForm(ctx: ContentContext): void {
	const member = memberOrNoRecords(ctx);
	if (member) sendHtml(ctx.res, 200, openSubAccountScreen(member));
}

async function review(ctx: ContentContext): Promise<void> {
	const form = await readForm(ctx.req);
	const member = memberOrNoRecords(ctx);
	if (!member) return;
	const values = {
		product: form.get('selProd') ?? '',
		initialDeposit: (form.get('txtAmt') ?? '').trim(),
		nickname: (form.get('txtNick') ?? '').trim(),
	};
	const problem = validate(values);
	if (problem) {
		sendHtml(ctx.res, 200, openSubAccountScreen(member, { message: problem, values }));
		return;
	}
	const pending: PendingSubAccount = { memberId: member.id, ...values, product: values.product as Product };
	ctx.session.pending = pending;
	sendHtml(ctx.res, 200, confirmSubAccountScreen(ctx.app.tenant, member, pending));
}

function validate(values: { product: string; initialDeposit: string; nickname: string }): MessageKey | undefined {
	if (!(PRODUCTS as readonly string[]).includes(values.product)) return 'invalidProduct';
	if (!DEPOSIT.test(values.initialDeposit) || Number(values.initialDeposit) <= 0) return 'invalidDeposit';
	if (values.nickname === '') return 'nicknameRequired';
	if (values.nickname.length > 30) return 'nicknameTooLong';
	return undefined;
}

async function commit(ctx: ContentContext): Promise<void> {
	await readForm(ctx.req);
	const { session, app, res } = ctx;
	if (!session.pending) {
		sendHtml(res, 200, memberSearchScreen(app.tenant, { message: 'noPending' }));
		return;
	}
	session.lastOpened = app.ledger.open(session.pending);
	delete session.pending;
	redirect(res, 303, '/subaccount/opened');
}

function showOpened({ session, app, res }: ContentContext): void {
	if (!session.lastOpened) {
		redirect(res, 302, '/member/search');
		return;
	}
	sendHtml(res, 200, subAccountOpenedScreen(app.tenant, session.lastOpened));
}
