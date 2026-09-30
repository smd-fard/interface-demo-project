import { esc, nest, page } from '../html/legacy.js';
import type { Tenant } from '../tenants/tenants.js';

/** The banner frame: institution branding and the product version string. */
export function bannerScreen(tenant: Tenant): string {
	const inner = `<table width="100%" border="0" cellpadding="6" cellspacing="0"><tr>
<td><font face="Arial" size="5" color="#FFFFFF"><b>${esc(tenant.institution)}</b></font></td>
<td align="right"><font face="Arial" size="2" color="#FFFFCC">${esc(tenant.version)}</font></td>
</tr></table>`;
	return page({ title: tenant.version, bgcolor: tenant.bannerColor, body: nest(inner, 2) });
}
