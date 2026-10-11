import { join } from "node:path";
import type { Context } from "./context.ts";
import { UsageError } from "./errors.ts";
import { pickExperiment } from "./pick.ts";
import { openPrompts } from "./prompt.ts";
import { resolveRoot } from "./root.ts";

/** `sprout open [query]`: picks one experiment and prints its path. */
export async function open(args: string[], ctx: Context): Promise<number> {
	if (args.length > 1) throw new UsageError("open takes at most one query");
	// An empty query matches everything, like no query.
	const query = args[0] || undefined;
	using prompts = openPrompts(ctx);
	const root = await resolveRoot(ctx.env);
	const experiment = await pickExperiment(root, query, prompts, ctx);
	ctx.stdout.write(`${join(root, experiment.dirName)}\n`);
	return 0;
}
