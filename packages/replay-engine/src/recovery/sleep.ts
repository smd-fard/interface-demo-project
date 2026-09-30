/** Waits `ms` on a real timer (the default backoff sleeper; unit tests inject an instant one). */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
