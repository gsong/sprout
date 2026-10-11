import { join } from "node:path";
import type { Context } from "./context.ts";
import {
	dockerObjects,
	readProjectName,
	removeDockerObjects,
} from "./docker.ts";
import { SproutError, UsageError } from "./errors.ts";
import { pickExperiment } from "./pick.ts";
import { askYes, openPrompts } from "./prompt.ts";
import { resolveRoot } from "./root.ts";
import { runChecked } from "./run.ts";

/**
 * `sprout rm [query]`: picks one experiment, asks for confirmation, and moves
 * it to the Trash. When it used containerized Claude Code, rm then removes its
 * Docker objects, and Docker trouble only warns. It prints nothing on stdout.
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
	const projectName = await readProjectName(path);
	if (projectName !== undefined) {
		const { image, volume, network } = dockerObjects(projectName);
		ctx.stderr.write(
			`Docker: image ${image}, volume ${volume}, network ${network}\n`,
		);
	}
	if (!(await askYes(prompts, "Remove? [y/N] "))) {
		throw new SproutError("cancelled");
	}
	await moveToTrash(path, ctx);
	if (projectName !== undefined) {
		await removeDockerObjects(root, experiment.dirName, projectName, ctx);
	}
	return 0;
}

/**
 * Moves `path` to the macOS Trash with the trash program. A failure stops
 * sprout with trash's message. Ctrl-C stops trash.
 */
async function moveToTrash(path: string, ctx: Context): Promise<void> {
	await runChecked(
		[ctx.programs.trash, path],
		ctx,
		(reason) =>
			new SproutError(`could not move ${path} to the Trash: ${reason}`),
	);
}
