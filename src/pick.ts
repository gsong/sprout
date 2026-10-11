import type { Context } from "./context.ts";
import { SproutError } from "./errors.ts";
import {
	type Experiment,
	experimentLine,
	matchesQuery,
	readExperiments,
} from "./experiments.ts";
import { openPrompts, type Prompts } from "./prompt.ts";

/**
 * Picks one experiment in `root` whose directory name contains `query`,
 * ignoring case. Without a query, every experiment matches. One match is used
 * directly. Several matches show a numbered pick list on stderr and ask for a
 * number, which needs a terminal attached.
 */
export async function pickExperiment(
	root: string,
	query: string | undefined,
	ctx: Context,
): Promise<Experiment> {
	const matches = (await readExperiments(root)).filter((experiment) =>
		matchesQuery(experiment, query ?? ""),
	);
	const [only] = matches;
	if (only === undefined) {
		throw new SproutError(
			query === undefined
				? `no experiments in ${root}`
				: `no experiment matches '${query}'`,
		);
	}
	if (matches.length === 1) return only;
	using prompts = openPrompts(ctx);
	if (!prompts.attached) {
		throw new SproutError(
			query === undefined
				? `${matches.length} experiments exist; pick one in a terminal or give a query`
				: `'${query}' matches ${matches.length} experiments; pick one in a terminal or use a longer query`,
		);
	}
	showPickList(matches, ctx);
	// Awaiting here keeps the prompts open until the answer arrives.
	return await askNumber(matches, prompts);
}

/** Writes one numbered line per experiment on stderr, numbers lined up. */
function showPickList(matches: Experiment[], ctx: Context): void {
	const width = String(matches.length).length;
	matches.forEach((experiment, index) => {
		const number = String(index + 1).padStart(width);
		ctx.stderr.write(`${number}) ${experimentLine(experiment)}\n`);
	});
}

/**
 * Asks for the number of one experiment in `matches`. An empty answer cancels,
 * and any other answer that is not a listed number asks again.
 */
async function askNumber(
	matches: Experiment[],
	prompts: Prompts,
): Promise<Experiment> {
	for (;;) {
		const answer = (await prompts.ask(`Number [1-${matches.length}]: `)).trim();
		if (answer === "") throw new SproutError("cancelled");
		const picked = /^\d+$/.test(answer)
			? matches[Number(answer) - 1]
			: undefined;
		if (picked !== undefined) return picked;
	}
}
