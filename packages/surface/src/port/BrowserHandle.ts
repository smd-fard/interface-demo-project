/**
 * An opaque handle on the live browser session, kept by the session layer for the human handoff: it can
 * bring the window to the front and close it. The browser objects behind it stay inside `@idp/surface`.
 */
export interface BrowserHandle {
	bringToFront(): Promise<void>;
	close(): Promise<void>;
	readonly closed: boolean;
}
