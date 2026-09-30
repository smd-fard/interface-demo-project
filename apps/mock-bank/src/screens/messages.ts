import { redMessage } from '../html/legacy.js';

/** The server-rendered messages. Their text is a public contract: artifacts' outcome rules match on it. */
export const MESSAGES = {
	noRecords: 'No records match your search criteria',
	invalidMemberNumber: 'Invalid Member Number',
	invalidCredentials: 'Invalid User ID or Password',
	sessionExpired: 'Your session has expired. Please sign on again.',
	notAuthorized: 'You are not authorized for this function (SEC-403)',
	invalidDeposit: 'Invalid Initial Deposit',
	invalidProduct: 'Invalid Product',
	nicknameRequired: 'Nickname is required',
	nicknameTooLong: 'Nickname must be 30 characters or fewer',
	noPending: 'No pending sub-account request',
	knownDialog: 'Scheduled maintenance tonight at 11 PM',
	unknownDialog: 'Printer queue PRN-07 is offline. Retry?',
} as const;

/** The key of a server-rendered message. */
export type MessageKey = keyof typeof MESSAGES;

/** A message row as the legacy screens show it: red `<font>`, no semantics. */
export function messageHtml(key: MessageKey | undefined): string {
	return key === undefined ? '' : redMessage(MESSAGES[key]);
}
