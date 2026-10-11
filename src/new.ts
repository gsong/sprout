import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { containerFiles } from "./container.ts";
import type { Context } from "./context.ts";
import { SproutError } from "./errors.ts";
import { type ExperimentFile, fileOperation } from "./files.ts";
import { untilInterrupted } from "./interrupt.ts";
import { toName, tryName } from "./name.ts";
import { askYes, openPrompts, type Prompts } from "./prompt.ts";
import { resolveRoot } from "./root.ts";
import { suggestName } from "./suggest.ts";

/** A directory `new` made, and the final name in it, with any `-2` suffix. */
interface NewDirectory {
	path: string;
	name: string;
}

/**
 * The variables that tie git to one repo, from `git rev-parse
 * --local-env-vars`. A git hook, for example, sets `GIT_DIR`.
 */
const repoEnvVars = [
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_CONFIG",
	"GIT_CONFIG_PARAMETERS",
	"GIT_CONFIG_COUNT",
	"GIT_OBJECT_DIRECTORY",
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_IMPLICIT_WORK_TREE",
	"GIT_GRAFT_FILE",
	"GIT_INDEX_FILE",
	"GIT_NO_REPLACE_OBJECTS",
	"GIT_REPLACE_REF_BASE",
	"GIT_PREFIX",
	"GIT_SHALLOW_FILE",
	"GIT_COMMON_DIR",
];

/** `sprout new [words...]`: creates an experiment and prints its path. */
export async function newExperiment(
	args: string[],
	ctx: Context,
): Promise<number> {
	using prompts = openPrompts(ctx);
	if (args.length === 0 && !prompts.attached) {
		throw new SproutError("new needs a description");
	}
	const root = await resolveRoot(ctx.env);
	const description =
		args.length > 0 ? args.join(" ") : await askDescription(prompts);
	// When claude fails, the suggestion comes from the description.
	const suggestion =
		(await suggestName(description, ctx)) ?? tryName(description);
	const name = await confirmName(suggestion, description, prompts, ctx);
	const containerized = await askContainer(prompts);
	await fileOperation(root, (path) => mkdir(path, { recursive: true }));
	const directory = await makeFreeDirectory(
		root,
		`${localDate(ctx.now())}-`,
		name,
	);
	try {
		await fillExperiment(directory, description, containerized, ctx);
	} catch (error) {
		await rm(directory.path, { recursive: true, force: true }).catch(
			(cleanup: Error) => {
				ctx.stderr.write(
					`sprout: could not remove ${directory.path}: ${cleanup.message}\n`,
				);
			},
		);
		throw error;
	}
	ctx.stdout.write(`${directory.path}\n`);
	return 0;
}

/** Asks for the description until the answer is not blank, and keeps it as typed. */
async function askDescription(prompts: Prompts): Promise<string> {
	for (;;) {
		const answer = await prompts.ask("Description: ");
		if (answer.trim() !== "") return answer;
	}
}

/**
 * Shows the suggestion. Enter accepts it, and typed text replaces it through
 * the name rules. Without a suggestion, the user must type a name. With no
 * terminal attached, the suggestion is the name, and a missing one stops new.
 */
async function confirmName(
	suggestion: string | undefined,
	description: string,
	prompts: Prompts,
	ctx: Context,
): Promise<string> {
	if (!prompts.attached) return suggestion ?? toName(description);
	const question =
		suggestion === undefined ? "Name: " : `Name [${suggestion}]: `;
	for (;;) {
		const answer = (await prompts.ask(question)).trim();
		if (answer === "") {
			if (suggestion !== undefined) return suggestion;
			continue;
		}
		try {
			return toName(answer);
		} catch (error) {
			if (!(error instanceof SproutError)) throw error;
			ctx.stderr.write(`sprout: ${error.message}\n`);
		}
	}
}

/**
 * Asks whether the experiment gets containerized Claude Code. Only `y` or
 * `yes`, in any case, means yes. With no terminal attached, the answer is no.
 */
async function askContainer(prompts: Prompts): Promise<boolean> {
	if (!prompts.attached) return false;
	return askYes(prompts, "Containerized Claude Code? [y/N] ");
}

/**
 * Writes the experiment's files, with the container files when `containerized`
 * is true, and commits all of them in a new git repo.
 */
async function fillExperiment(
	directory: NewDirectory,
	description: string,
	containerized: boolean,
	ctx: Context,
): Promise<void> {
	const files: Record<string, ExperimentFile> = {
		"README.md": { text: `# ${directory.name}\n\n${description}\n` },
		...(containerized ? containerFiles(basename(directory.path)) : {}),
	};
	for (const [file, { text, mode }] of Object.entries(files)) {
		await fileOperation(join(directory.path, file), async (path) => {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, text);
			// chmod, unlike writeFile's mode, does not lose bits to the umask.
			if (mode !== undefined) await chmod(path, mode);
		});
	}
	const git = (...args: string[]) => runGit(directory.path, ctx, args);
	await git("init");
	// --force commits a file even when the user's own gitignore matches it.
	await git("add", "--force", "--", ...Object.keys(files));
	await git("commit", "--message", "chore: start experiment");
}

/**
 * Makes `<root>/<prefix><name>`. When that exists, it tries `-2`, `-3`, and so
 * on after the name, and makes the first that is free.
 */
async function makeFreeDirectory(
	root: string,
	prefix: string,
	name: string,
): Promise<NewDirectory> {
	for (let n = 1; ; n++) {
		const finalName = n === 1 ? name : `${name}-${n}`;
		const path = join(root, `${prefix}${finalName}`);
		const made = await fileOperation(path, (path) =>
			mkdir(path).then(
				() => true,
				(error: NodeJS.ErrnoException) => {
					if (error.code === "EEXIST") return false;
					throw error;
				},
			),
		);
		if (made) return { path, name: finalName };
	}
}

/**
 * Runs git in `cwd` with sprout's env, so git reads the user's own config. Its
 * output stays off sprout's stdout. A failure stops sprout with git's message.
 * Ctrl-C stops git.
 */
async function runGit(
	cwd: string,
	ctx: Context,
	args: string[],
): Promise<void> {
	const gitEnv = { ...ctx.env };
	for (const name of repoEnvVars) delete gitEnv[name];
	let git: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		git = Bun.spawn(["git", ...args], {
			cwd,
			env: gitEnv,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch (error) {
		throw new SproutError(`git ${args[0]} failed: ${(error as Error).message}`);
	}
	const output = Promise.all([
		git.exited,
		new Response(git.stdout).text(),
		new Response(git.stderr).text(),
	]);
	// Sprout stops waiting on the pipes after Ctrl-C, since a git hook could
	// hold them open.
	const [exitCode, stdout, stderr] = await untilInterrupted(
		ctx.interrupted,
		output,
		() => {
			git.kill();
			return git.exited;
		},
	);
	if (exitCode !== 0) {
		const reason = (stderr.trim() || stdout.trim()).split("\n")[0];
		throw new SproutError(`git ${args[0]} failed: ${reason}`);
	}
}

/** The `YYYY-MM-DD` date of `time` in the local time zone. */
function localDate(time: Date): string {
	const month = String(time.getMonth() + 1).padStart(2, "0");
	const day = String(time.getDate()).padStart(2, "0");
	return `${time.getFullYear()}-${month}-${day}`;
}
