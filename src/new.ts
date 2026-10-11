import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "./context.ts";
import { SproutError } from "./errors.ts";
import { fileOperation } from "./files.ts";
import { toName } from "./name.ts";
import { resolveRoot } from "./root.ts";
import { suggestName } from "./suggest.ts";

type Env = Context["env"];

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
	if (args.length === 0) throw new SproutError("new needs a description");
	const description = args.join(" ");
	const root = await resolveRoot(ctx.env);
	// When claude fails, the name comes from the description. An empty one
	// stops new with the name rules' error, because new cannot prompt yet.
	const name = (await suggestName(description, ctx)) ?? toName(description);
	await fileOperation(root, (path) => mkdir(path, { recursive: true }));
	const directory = await makeFreeDirectory(
		root,
		`${localDate(ctx.now())}-`,
		name,
	);
	try {
		await fillExperiment(directory, description, ctx.env);
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

/** Writes the experiment's files and commits all of them in a new git repo. */
async function fillExperiment(
	directory: NewDirectory,
	description: string,
	env: Env,
): Promise<void> {
	const files: Record<string, string> = {
		"README.md": `# ${directory.name}\n\n${description}\n`,
	};
	for (const [file, text] of Object.entries(files)) {
		await fileOperation(join(directory.path, file), (path) =>
			writeFile(path, text),
		);
	}
	const git = (...args: string[]) => runGit(directory.path, env, args);
	await git("init");
	await git("add", "--", ...Object.keys(files));
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
 */
async function runGit(cwd: string, env: Env, args: string[]): Promise<void> {
	const gitEnv = { ...env };
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
	const [exitCode, stdout, stderr] = await Promise.all([
		git.exited,
		new Response(git.stdout).text(),
		new Response(git.stderr).text(),
	]);
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
