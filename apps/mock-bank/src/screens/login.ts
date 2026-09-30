import { formRow, grid, heading, passwordInput, spanRow, submit, textInput } from '../html/legacy.js';
import { messageHtml, type MessageKey } from './messages.js';
import { contentScreen } from './shell.js';

/** Sign On. The heading sits inside the form; `txtUser` comes before `txtPwd`; no hidden inputs. */
export function loginScreen(options: { message?: MessageKey; userId?: string } = {}): string {
	const form = `<form method="post" action="/login">
${grid(
	[
		spanRow(heading('Sign On')),
		spanRow(messageHtml(options.message)),
		formRow('User ID', textInput('txtUser', { value: options.userId ?? '' })),
		formRow('Password', passwordInput('txtPwd')),
		spanRow(submit('btnSignOn', 'Sign On')),
	],
	{ width: '400' },
)}
</form>`;
	return contentScreen('Sign On', form);
}
