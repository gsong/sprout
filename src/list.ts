import type { Context } from "./context.ts";
import { UsageError } from "./errors.ts";
import {
	experimentLine,
	matchesQuery,
	readExperiments,
} from "./experiments.ts";
import { resolveRoot } from "./root.ts";

/**
 * `sprout list [filter]`: prints one line per experiment on stdout. On a
 * terminal, a blank line separates experiments, and each directory name is
 * bold unless `NO_COLOR` is set.
 */
export async function list(args: string[], ctx: Context): Promise<number> {
	if (args.length > 1) throw new UsageError("list takes at most one filter");
	const [filter = ""] = args;
	const root = await resolveRoot(ctx.env);
	const experiments = (await readExperiments(root)).filter((experiment) =>
		matchesQuery(experiment, filter),
	);
	const terminal = ctx.stdout.isTTY === true;
	const bold = terminal && !ctx.env.NO_COLOR;
	const lines = experiments.map((experiment) =>
		experimentLine(
			bold
				? { ...experiment, dirName: `\x1b[1m${experiment.dirName}\x1b[22m` }
				: experiment,
		),
	);
	ctx.stdout.write(lines.map((line) => `${line}\n`).join(terminal ? "\n" : ""));
	return 0;
}
