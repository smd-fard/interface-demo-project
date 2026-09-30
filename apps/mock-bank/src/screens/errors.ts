import { esc, grid, heading, nest, page, spanRow } from '../html/legacy.js';
import { messageHtml } from './messages.js';
import { contentScreen } from './shell.js';

/** The legacy application error page (fault `app_error`, HTTP 500). */
export function appErrorScreen(path: string): string {
	return page({
		title: 'Server Error',
		body: `<font face="Verdana" size="4" color="#CC0000"><i>Server Error in '/CoreOne' Application.</i></font>
<hr size="1" color="silver">
<font face="Verdana" size="3"><b>Runtime Error — ORA-06512: at "CORE1.PKG_MBR_INQ", line 212</b></font><br><br>
<font face="Verdana" size="2"><b>Description:</b> An application error occurred on the server while processing ${esc(path)}.
Contact your system administrator.</font>
<hr size="1" color="silver">
<font face="Verdana" size="1">CoreOne Application Server</font>`,
	});
}

/** The web tier's "Service Unavailable" page (faults `failed_load`, `failed_load_persistent`, HTTP 503). */
export function serviceUnavailableScreen(): string {
	return page({
		title: 'Service Unavailable',
		body: nest(
			`<font face="Verdana" size="4"><b>Service Unavailable</b></font><br>
<font face="Verdana" size="2">HTTP Error 503. The service is temporarily unable to handle the request.</font>`,
			3,
		),
	});
}

/** The security denial (fault `permission_denied`, or a teller without the entitlement). */
export function permissionDeniedScreen(): string {
	return contentScreen(
		'Security',
		grid([spanRow(heading('Security Notice')), spanRow(messageHtml('notAuthorized'))], { width: '500' }),
	);
}

/** An unknown route. */
export function notFoundScreen(): string {
	return page({
		title: 'Page Not Found',
		body: nest('<font face="Verdana" size="3">The page cannot be found.</font>', 3),
	});
}
