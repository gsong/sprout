import { lstat, rename as move, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "./context.ts";
import { SproutError, UsageError } from "./errors.ts";
import { headingIndex } from "./experiments.ts";
import { fileOperation, unlessMissing } from "./files.ts";
import { toName } from "./name.ts";
import { pickExperiment } from "./pick.ts";
import { openPrompts } from "./prompt.ts";
import { resolveRoot } from "./root.ts";

/**
 * `sprout rename <query> <new name...>`: picks one experiment and gives it a
 * new name, keeping its date. It prints the new path.
 */
export async function rename(args: string[], ctx: Context): Promise<number> {
	const [query, ...words] = args;
	if (query === undefined || words.length === 0) {
		throw new UsageError("rename needs a query and a new name");
	}
	const name = toName(words.join(" "));
	using prompts = openPrompts(ctx);
	const root = await resolveRoot(ctx.env);
	const experiment = await pickExperiment(root, query, prompts, ctx);
	const dirName =
		experiment.date === undefined ? name : `${experiment.date}-${name}`;
	const from = join(root, experiment.dirName);
	const to = join(root, dirName);
	if (await takenByOther(from, to)) {
		throw new SproutError(`${to} already exists`);
	}
	const readme = await unlessMissing(join(from, "README.md"), (path) =>
		readFile(path, "utf8"),
	);
	await fileOperation(from, (path) => move(path, to));
	const renamed =
		readme === undefined
			? undefined
			: renameHeading(readme, experiment.name, name);
	if (renamed !== undefined) {
		await fileOperation(join(to, "README.md"), (path) =>
			writeFile(path, renamed),
		);
	}
	ctx.stdout.write(`${to}\n`);
	return 0;
}

/**
 * The README with its heading set to `# <name>`, or `undefined` when the
 * heading no longer reads exactly `# <oldName>`.
 */
function renameHeading(
	readme: string,
	oldName: string,
	name: string,
): string | undefined {
	const lines = readme.split("\n");
	const index = headingIndex(lines);
	if (lines[index] !== `# ${oldName}`) return undefined;
	lines[index] = `# ${name}`;
	return lines.join("\n");
}

/**
 * Whether something other than `from` already exists at `to`. On a
 * case-insensitive file system, a new name that differs only in case finds
 * `from` itself, and that is free. The same path is never free.
 */
async function takenByOther(from: string, to: string): Promise<boolean> {
	const existing = await unlessMissing(to, lstat);
	if (existing === undefined) return false;
	if (from === to) return true;
	const self = await fileOperation(from, lstat);
	return existing.ino !== self.ino || existing.dev !== self.dev;
}
