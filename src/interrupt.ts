import { Interrupted } from "./errors.ts";

/**
 * Waits for `work`, unless the user presses Ctrl-C first. Then it runs `stop`
 * to end the work and throws `Interrupted`.
 */
export async function untilInterrupted<T>(
	signal: AbortSignal,
	work: Promise<T>,
	stop?: () => Promise<unknown>,
): Promise<T> {
	let onAbort = () => {};
	const aborted = new Promise<"interrupted">((resolve) => {
		onAbort = () => resolve("interrupted");
		if (signal.aborted) onAbort();
		signal.addEventListener("abort", onAbort, { once: true });
	});
	const done = work.then((value) => ({ value }));
	// Work that fails after Ctrl-C has nobody waiting for it.
	done.catch(() => {});
	try {
		const result = await Promise.race([done, aborted]);
		if (result === "interrupted") {
			await stop?.();
			throw new Interrupted();
		}
		return result.value;
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
