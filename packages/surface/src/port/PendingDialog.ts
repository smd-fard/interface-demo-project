/** A native dialog (alert/confirm/prompt/beforeunload) that is open and not yet settled. */
export interface PendingDialog {
	readonly type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
	readonly message: string;
}
