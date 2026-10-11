import { basename } from "node:path";
import type { Context } from "./context.ts";
import { Interrupted } from "./errors.ts";
import { untilInterrupted } from "./interrupt.ts";

/** How an outside program ended, with everything it printed. */
export interface ProgramResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/**
 * Runs `command` with stdin closed and its output captured, so nothing it
 * prints reaches sprout's stdout. Ctrl-C stops it. Throws the spawn error when
 * the program cannot start.
 */
export async function runProgram(
	command: string[],
	ctx: Context,
	options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<ProgramResult> {
	const program = Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env ?? ctx.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = Promise.all([
		program.exited,
		new Response(program.stdout).text(),
		new Response(program.stderr).text(),
	]);
	// Sprout stops waiting on the pipes after Ctrl-C, since a child of the
	// program could hold them open.
	const [exitCode, stdout, stderr] = await untilInterrupted(
		ctx.interrupted,
		output,
		() => {
			program.kill();
			return program.exited;
		},
	);
	return { exitCode, stdout, stderr };
}

/**
 * Runs `command` like `runProgram` and gives its stdout. When the program
 * cannot start or exits with a failure, it throws `fail(reason)`. Ctrl-C
 * throws `Interrupted`.
 */
export async function runChecked(
	command: string[],
	ctx: Context,
	fail: (reason: string) => Error,
	options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<string> {
	const [program = ""] = command;
	const name = basename(program);
	let result: ProgramResult;
	try {
		result = await runProgram(command, ctx, options);
	} catch (error) {
		if (error instanceof Interrupted) throw error;
		const notOnPath =
			(error as NodeJS.ErrnoException).code === "ENOENT" &&
			!program.includes("/");
		throw fail(notOnPath ? `${name} is not on PATH` : (error as Error).message);
	}
	if (result.exitCode !== 0) throw fail(failureReason(name, result));
	return result.stdout;
}

/**
 * Why a program failed: the first line of its stderr, or of its stdout when
 * stderr is empty, or its exit code when it printed nothing.
 */
export function failureReason(name: string, result: ProgramResult): string {
	const output = result.stderr.trim() || result.stdout.trim();
	return output.split("\n")[0] || `${name} exited with code ${result.exitCode}`;
}
