import { join } from "node:path";
import type { Context } from "./context.ts";
import { SproutError, UsageError } from "./errors.ts";
import { untilInterrupted } from "./interrupt.ts";
import { pickExperiment } from "./pick.ts";
import { askYes, openPrompts } from "./prompt.ts";
import { resolveRoot } from "./root.ts";

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
	let trash: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		trash = Bun.spawn([ctx.programs.trash, path], {
			env: ctx.env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch (error) {
		throw fail((error as Error).message);
	}
	const output = Promise.all([
		trash.exited,
		new Response(trash.stdout).text(),
		new Response(trash.stderr).text(),
	]);
	const [exitCode, stdout, stderr] = await untilInterrupted(
		ctx.interrupted,
		output,
		() => {
			trash.kill();
			return trash.exited;
		},
	);
	if (exitCode !== 0) {
		const reason = (stderr.trim() || stdout.trim()).split("\n")[0];
		throw fail(reason || `trash exited with code ${exitCode}`);
	}
}
