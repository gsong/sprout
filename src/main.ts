import packageJson from "../package.json" with { type: "json" };
import type { Context } from "./context.ts";
import { Interrupted, SproutError, UsageError } from "./errors.ts";
import { list } from "./list.ts";
import { newExperiment } from "./new.ts";
import { open } from "./open.ts";
import { rm } from "./rm.ts";

const commands = [
	{
		name: "new",
		usage: "sprout new [words...]",
		summary: "Create an experiment and print its path",
	},
	{
		name: "list",
		usage: "sprout list [filter]",
		summary: "List experiments, newest first",
	},
	{
		name: "open",
		usage: "sprout open [query]",
		summary: "Print the path of one experiment",
	},
	{
		name: "rm",
		usage: "sprout rm [query]",
		summary: "Move an experiment to the Trash",
	},
	{
		name: "rename",
		usage: "sprout rename <query> <new name...>",
		summary: "Rename an experiment and print its new path",
	},
];

/** Runs one sprout command and returns its exit code. */
export async function main(args: string[], ctx: Context): Promise<number> {
	try {
		return await dispatch(args, ctx);
	} catch (error) {
		// A program that Ctrl-C stopped can fail before sprout sees the signal.
		if (error instanceof Interrupted || ctx.interrupted.aborted) {
			// The terminal echoes ^C. A newline puts the shell prompt after it.
			ctx.stderr.write("\n");
			return 130;
		}
		if (error instanceof UsageError) {
			ctx.stderr.write(
				`sprout: ${error.message}\nRun 'sprout --help' for usage.\n`,
			);
			return 2;
		}
		if (error instanceof SproutError) {
			ctx.stderr.write(`sprout: ${error.message}\n`);
			return 1;
		}
		throw error;
	}
}

async function dispatch(args: string[], ctx: Context): Promise<number> {
	const [command, ...rest] = args;
	if (command === undefined) {
		ctx.stderr.write(helpText());
		return 2;
	}
	if (command === "--version") {
		ctx.stdout.write(`${packageJson.version}\n`);
		return 0;
	}
	if (command === "--help") {
		ctx.stdout.write(helpText());
		return 0;
	}
	if (command === "new") {
		return newExperiment(rest, ctx);
	}
	if (command === "list") {
		return list(rest, ctx);
	}
	if (command === "open") {
		return open(rest, ctx);
	}
	if (command === "rm") {
		return rm(rest, ctx);
	}
	if (commands.some(({ name }) => name === command)) {
		throw new SproutError(`'${command}' is not built yet`);
	}
	throw new UsageError(`unknown command '${command}'`);
}

function helpText(): string {
	const width =
		Math.max(...commands.map((command) => command.usage.length)) + 2;
	const lines = commands.map(
		(command) => `  ${command.usage.padEnd(width)}${command.summary}`,
	);
	return `Sprout spins up experiments in one central root.

Usage:
${lines.join("\n")}

Options:
  --help     Show this help
  --version  Print the version
`;
}
