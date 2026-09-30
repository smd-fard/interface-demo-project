import { dataRow, grid, heading } from '../html/legacy.js';
import type { Tenant } from '../tenants/tenants.js';
import { contentScreen } from './shell.js';

/** About CoreOne: the version and build, as legacy apps show them. */
export function aboutScreen(tenant: Tenant): string {
	return contentScreen(
		'About',
		`${heading('About CoreOne')}<br>
${grid([dataRow('Product', tenant.version), dataRow('Build', tenant.build), dataRow('Licensed To', tenant.institution)], { width: '60%' })}
<p><font size="1">Synthetic demonstration system. Contains no real member data.</font></p>`,
	);
}
