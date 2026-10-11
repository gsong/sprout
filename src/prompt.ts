import { createInterface } from "node:readline";
import type { Context } from "./context.ts";
import { Interrupted, SproutError } from "./errors.ts";
import { untilInterrupted } from "./interrupt.ts";

/** Asks questions on stderr and reads each answer as one line of stdin. */
export interface Prompts extends Disposable {
	/** Whether a terminal is attached, so sprout may ask. */
	attached: boolean;
	/** Shows `question` and gives the answer without its line ending. */
	ask(question: string): Promise<string>;
}

/**
 * Opens prompts on the context's stdin. It reads nothing until the first
 * question. Disposing it stops reading, so sprout can exit.
 */
export function openPrompts(ctx: Context): Prompts {
	let lines: AsyncIterator<string> | undefined;
	let close = () => {};
	return {
		attached: ctx.stdin.isTTY === true,
		async ask(question) {
			if (lines === undefined) {
				// `terminal: false` leaves line editing and Ctrl-C to the terminal
				// itself, so Ctrl-C reaches sprout as SIGINT.
				const reader = createInterface({ input: ctx.stdin, terminal: false });
				close = () => reader.close();
				lines = reader[Symbol.asyncIterator]();
			}
			// A program that Ctrl-C stopped can end before sprout sees the signal.
			// Sprout then must not ask a question nobody will answer.
			if (ctx.interrupted.aborted) throw new Interrupted();
			ctx.stderr.write(question);
			const line = await untilInterrupted(ctx.interrupted, lines.next());
			if (line.done) {
				// End the prompt's line so the error starts on its own.
				ctx.stderr.write("\n");
				throw new SproutError("cancelled");
			}
			return line.value;
		},
		[Symbol.dispose]() {
			close();
		},
	};
}

/**
 * Asks a yes-or-no question. Only `y` or `yes`, in any case and with any
 * surrounding space, means yes. Anything else means no.
 */
export async function askYes(
	prompts: Prompts,
	question: string,
): Promise<boolean> {
	const answer = await prompts.ask(question);
	return ["y", "yes"].includes(answer.trim().toLowerCase());
}
