import { join } from "node:path";
import type { Context } from "./context.ts";
import { Interrupted, SproutError, UsageError } from "./errors.ts";
import { pickExperiment } from "./pick.ts";
import { askYes, openPrompts } from "./prompt.ts";
import { resolveRoot } from "./root.ts";
import { failureReason, type ProgramResult, runProgram } from "./run.ts";

/**
 * `sprout rm [query]`: picks one experiment, asks for confirmation, and moves
 * it to the Trash. It prints nothing on stdout.
 */
export async function rm(args: string[], ctx: Context): Promise<number> {
	if (args.length > 1) throw new UsageError("rm takes at most one query");
	// An empty query matches everything, like no query.
	const query = args[0] || undefined;
	using prompts = openPrompts(ctx);
	if (!prompts.attached) {
		throw new SproutError("rm needs a terminal to confirm");
	}
	const root = await resolveRoot(ctx.env);
	const experiment = await pickExperiment(root, query, prompts, ctx);
	const path = join(root, experiment.dirName);
	ctx.stderr.write(`${path}\n`);
	if (experiment.description !== undefined) {
		ctx.stderr.write(`${experiment.description}\n`);
	}
	if (!(await askYes(prompts, "Remove? [y/N] "))) {
		throw new SproutError("cancelled");
	}
	await moveToTrash(path, ctx);
	return 0;
}

/**
 * Moves `path` to the macOS Trash with the trash program. A failure stops
 * sprout with trash's message. Ctrl-C stops trash.
 */
async function moveToTrash(path: string, ctx: Context): Promise<void> {
	const fail = (reason: string) =>
		new SproutError(`could not move ${path} to the Trash: ${reason}`);
	let result: ProgramResult;
	try {
		result = await runProgram([ctx.programs.trash, path], ctx);
	} catch (error) {
		if (error instanceof Interrupted) throw error;
		throw fail((error as Error).message);
	}
	if (result.exitCode !== 0) throw fail(failureReason("trash", result));
}
