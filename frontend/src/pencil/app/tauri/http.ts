/*
 * Platform shim — see ./env.ts.
 *
 * Upstream routes CORS-restricted requests (web fonts, the vectorize providers) through a Tauri
 * command so they bypass the browser's origin checks. open-prd has no such escape hatch in the
 * renderer; the plan is to proxy those calls through its own backend instead
 * (docs/plan-prototype-editor-migration.md 3.5 / 4.4).
 *
 * `withAbortSignal` is kept verbatim — it is plain promise plumbing with no Tauri dependency.
 */

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException("The operation was aborted", "AbortError");
}

export function withAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) {
		void promise.catch(() => undefined);
		return Promise.reject(abortReason(signal));
	}

	return new Promise<T>((resolve, reject) => {
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		const onAbort = () => {
			cleanup();
			reject(abortReason(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		void (async () => {
			try {
				const value = await promise;
				cleanup();
				resolve(value);
			} catch (error) {
				cleanup();
				reject(error instanceof Error ? error : new Error("HTTP request failed", { cause: error }));
			}
		})();
	});
}

/**
 * Falls back to a plain `fetch`. Requests that the target origin does not open up via CORS will
 * fail here; that is the known limitation the backend proxy is meant to remove.
 */
export async function tauriFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
	_maxResponseBytes?: number,
	timeoutMs?: number,
): Promise<Response> {
	if (timeoutMs === undefined) return fetch(input, init);
	return fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
