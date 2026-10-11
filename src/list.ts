import type { Context } from "./context.ts";
import { UsageError } from "./errors.ts";
import {
	experimentLine,
	matchesQuery,
	readExperiments,
} from "./experiments.ts";
import { resolveRoot } from "./root.ts";

/** `sprout list [filter]`: prints one line per experiment on stdout. */
export async function list(args: string[], ctx: Context): Promise<number> {
	if (args.length > 1) throw new UsageError("list takes at most one filter");
	const [filter = ""] = args;
	const root = await resolveRoot(ctx.env);
	const experiments = await readExperiments(root);
	for (const experiment of experiments.filter((experiment) =>
		matchesQuery(experiment, filter),
	)) {
		ctx.stdout.write(`${experimentLine(experiment)}\n`);
	}
	return 0;
}
