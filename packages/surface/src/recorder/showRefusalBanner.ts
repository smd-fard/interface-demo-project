/**
 * Runs in the page: a fixed banner telling the operator their gesture was refused and not performed.
 * Self-contained (serialized into the frame). The text names the verdict only, never a value.
 */
export const showRefusalBanner = ({ text, ms }: { text: string; ms: number }): void => {
	const id = 'idp-refusal-banner';
	document.getElementById(id)?.remove();
	const banner = document.createElement('div');
	banner.id = id;
	banner.setAttribute('role', 'alert');
	banner.textContent = text;
	banner.style.cssText =
		'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:6px 10px;background:#b00020;color:#fff;' +
		'font:bold 13px Arial,sans-serif;text-align:center;pointer-events:none';
	(document.body ?? document.documentElement).appendChild(banner);
	setTimeout(() => banner.remove(), ms);
};
