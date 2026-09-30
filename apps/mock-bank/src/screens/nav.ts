import { grid, link, nest, page } from '../html/legacy.js';
import type { Tenant } from '../tenants/tenants.js';

/** The nav frame: the tenant's menu, each link targeting the `content` frame. */
export function navScreen(tenant: Tenant): string {
	const rows = tenant.menu.map(
		(item) => `<tr><td nowrap><font face="Arial" size="2">${link(item.href, item.text, 'content')}</font></td></tr>`,
	);
	return page({
		title: 'Menu',
		bgcolor: '#DDDDCC',
		body: nest(grid(['<tr><td><b>Main Menu</b></td></tr>', ...rows]), 3),
	});
}
