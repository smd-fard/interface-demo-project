/** `control.json` of an attended session: where its control API is, and the file holding its token. */
export interface ControlFiles {
	readonly controlUrl: string;
	readonly tokenFile: string;
}
