import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { type Input, type ProgramName, programNames } from "../src/context.ts";
import { main } from "../src/main.ts";

/** What a fake outside program prints and returns when sprout runs it. */
export interface FakeProgram {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	/**
	 * Never exits on its own, after printing, and ignores SIGTERM. Only SIGKILL
	 * stops it.
	 */
	hang?: boolean;
	/**
	 * Replies for exact argument lists. A run whose arguments match one gets its
	 * output and exit code in place of the defaults above.
	 */
	replies?: FakeReply[];
}

/** What a fake program prints and returns for one exact argument list. */
export interface FakeReply {
	args: string[];
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}

/** One run of a fake program. */
export interface ProgramCall {
	args: string[];
	env: Record<string, string>;
	pid: number;
}

export interface HarnessOptions {
	/** Fakes for outside programs. A program left out fails with exit 127. */
	fakes?: Partial<Record<ProgramName, FakeProgram>>;
}

export interface RunOptions {
	/** Env vars to set over the defaults. `undefined` unsets one. */
	env?: Record<string, string | undefined>;
	/** Commands to run in place of the fakes, such as a bare `claude`. */
	programs?: Partial<Record<ProgramName, string>>;
	/**
	 * Attaches a terminal that types these answers. A string ends the input
	 * after its text. A stream stays open until the test ends it.
	 */
	stdin?: string | Readable;
	/** Presses Ctrl-C once stderr holds this text, such as a prompt. */
	interruptAt?: string;
	/** Presses Ctrl-C when this signal aborts. */
	signal?: AbortSignal;
}

export interface RunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** The time every run sees: noon on 2026-10-10, local time. */
export const today = "2026-10-10";
const now = new Date(2026, 9, 10, 12);

/** The git identity in the temporary home's `.gitconfig`. */
export const gitUser = { name: "Sprout Test", email: "sprout@example.com" };

export interface Harness extends AsyncDisposable {
	/** The temporary root, passed to sprout as SPROUT_ROOT. It exists at start. */
	root: string;
	/**
	 * The temporary home, passed to sprout as HOME. It exists at start and holds
	 * a `.gitconfig` with `gitUser`.
	 */
	home: string;
	/** The path of the fake for each outside program, as sprout receives it. */
	programs: Record<ProgramName, string>;
	/** Runs sprout's command entry point with these arguments. */
	run(args: string[], options?: RunOptions): Promise<RunResult>;
	/** Every run of a fake program, in order. */
	calls(program: ProgramName): Promise<ProgramCall[]>;
}

/**
 * Harness options with a fake claude that suggests `name`. Without it, the
 * suggestion fails and adds a warning to stderr.
 */
export function claudeSays(name: string): HarnessOptions {
	return { fakes: { claude: { stdout: `${name}\n` } } };
}

/** A function that runs git in `cwd` with the config in `home`, giving stdout. */
export function gitIn(cwd: string, home: string) {
	return (...args: string[]): string => {
		const result = Bun.spawnSync(["git", ...args], {
			cwd,
			env: { PATH: process.env.PATH, HOME: home },
		});
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		return result.stdout.toString();
	};
}

/**
 * Makes an experiment directory at `root/dirName`, with any missing parents,
 * and writes its README when given one.
 */
export async function addExperiment(
	root: string,
	dirName: string,
	readme?: string,
): Promise<void> {
	await mkdir(join(root, dirName), { recursive: true });
	if (readme !== undefined) {
		await writeFile(join(root, dirName, "README.md"), readme);
	}
}

/**
 * Makes a temporary directory with a root, a home, and fakes for every outside
 * program, so a test never touches the real Trash, Docker, or Claude sign-in.
 */
export async function createHarness(
	options: HarnessOptions = {},
): Promise<Harness> {
	const dir = await mkdtemp(join(tmpdir(), "sprout-test-"));
	const root = join(dir, "root");
	const home = join(dir, "home");
	const bin = join(dir, "bin");
	await Promise.all([mkdir(root), mkdir(home), mkdir(bin)]);
	await writeFile(
		join(home, ".gitconfig"),
		`[user]\n\tname = ${gitUser.name}\n\temail = ${gitUser.email}\n`,
	);

	const programs = {} as Record<ProgramName, string>;
	for (const name of programNames) {
		programs[name] = await writeFake(bin, name, options.fakes?.[name]);
	}

	return {
		root,
		home,
		programs,
		async run(args, options = {}) {
			const {
				env = {},
				programs: overrides = {},
				stdin,
				interruptAt,
				signal,
			} = options;
			let stdout = "";
			let stderr = "";
			const ctrlC = new AbortController();
			if (signal?.aborted) ctrlC.abort();
			signal?.addEventListener("abort", () => ctrlC.abort());
			const exitCode = await main(args, {
				env: {
					SPROUT_ROOT: root,
					HOME: home,
					XDG_CONFIG_HOME: join(home, ".config"),
					PATH: process.env.PATH,
					...env,
				},
				stdin: terminal(stdin),
				stdout: {
					write: (text) => {
						stdout += text;
					},
				},
				stderr: {
					write: (text) => {
						stderr += text;
						if (interruptAt !== undefined && stderr.includes(interruptAt)) {
							ctrlC.abort();
						}
					},
				},
				programs: { ...programs, ...overrides },
				now: () => now,
				interrupted: ctrlC.signal,
			});
			return { exitCode, stdout, stderr };
		},
		async calls(program) {
			const log = await readFile(callLog(bin, program), "utf8").catch(() => "");
			return log
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
		},
		async [Symbol.asyncDispose]() {
			await rm(dir, { recursive: true, force: true });
		},
	};
}

/**
 * Gives sprout a terminal that types `answers`. Without answers, sprout gets
 * empty input with no terminal attached.
 */
function terminal(answers?: string | Readable): Input {
	if (answers === undefined)
		return Object.assign(Readable.from([]), { isTTY: false });
	const input =
		typeof answers === "string" ? Readable.from([answers]) : answers;
	return Object.assign(input, { isTTY: true });
}

async function writeFake(
	bin: string,
	name: ProgramName,
	fake?: FakeProgram,
): Promise<string> {
	const behavior = fake ?? {
		stderr: `fake ${name}: no behavior set\n`,
		exitCode: 127,
	};
	const path = join(bin, name);
	await writeFile(
		path,
		`#!${process.execPath}
import { appendFileSync } from "node:fs";
const call = { args: process.argv.slice(2), env: process.env, pid: process.pid };
appendFileSync(${JSON.stringify(callLog(bin, name))}, JSON.stringify(call) + "\\n");
const replies = ${JSON.stringify(behavior.replies ?? [])};
const reply = replies.find((r) => JSON.stringify(r.args) === JSON.stringify(call.args)) ?? ${JSON.stringify({ stdout: behavior.stdout, stderr: behavior.stderr, exitCode: behavior.exitCode })};
process.stdout.write(reply.stdout ?? "");
process.stderr.write(reply.stderr ?? "");
process.exitCode = reply.exitCode ?? 0;
${behavior.hang ? 'process.on("SIGTERM", () => {});\nsetInterval(() => {}, 60_000);' : ""}
`,
	);
	await chmod(path, 0o755);
	return path;
}

function callLog(bin: string, name: ProgramName): string {
	return join(bin, `${name}.calls`);
}
