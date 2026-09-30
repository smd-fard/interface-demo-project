import { esc } from '../html/legacy.js';
import type { Tenant } from '../tenants/tenants.js';

/** The top frameset: `banner` across the top, `nav` on the left, `content` on the right. */
export function framesetScreen(tenant: Tenant, signedIn: boolean): string {
	const content = signedIn ? '/member/search' : '/login';
	return [
		'<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Frameset//EN">',
		'<html>',
		'<head>',
		'<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
		`<title>${esc(tenant.version)}</title>`,
		'</head>',
		'<frameset rows="64,*" border="0" frameborder="0" framespacing="0">',
		'<frame name="banner" src="/banner" scrolling="no" noresize marginheight="0" marginwidth="0">',
		'<frameset cols="180,*" border="1" frameborder="1">',
		'<frame name="nav" src="/nav" scrolling="auto">',
		`<frame name="content" src="${content}" scrolling="auto">`,
		'</frameset>',
		'<noframes>This application requires a browser that supports frames.</noframes>',
		'</frameset>',
		'</html>',
	].join('\n');
}
