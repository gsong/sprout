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
import { type ProgramName, programNames } from "../src/context.ts";
import { main } from "../src/main.ts";

/** What a fake outside program prints and returns when sprout runs it. */
export interface FakeProgram {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}

export interface HarnessOptions {
	/** Fakes for outside programs. A program left out fails with exit 127. */
	fakes?: Partial<Record<ProgramName, FakeProgram>>;
}

export interface RunOptions {
	/** Env vars to set over the defaults. `undefined` unsets one. */
	env?: Record<string, string | undefined>;
}

export interface RunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface Harness extends AsyncDisposable {
	/** The temporary root, passed to sprout as SPROUT_ROOT. It exists at start. */
	root: string;
	/** The temporary home, passed to sprout as HOME. It exists at start. */
	home: string;
	/** The path of the fake for each outside program, as sprout receives it. */
	programs: Record<ProgramName, string>;
	/** Runs sprout's command entry point with these arguments. */
	run(args: string[], options?: RunOptions): Promise<RunResult>;
	/** The argument lists sprout passed to a fake program, one per call. */
	calls(program: ProgramName): Promise<string[][]>;
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

	const programs = {} as Record<ProgramName, string>;
	for (const name of programNames) {
		programs[name] = await writeFake(bin, name, options.fakes?.[name]);
	}

	return {
		root,
		home,
		programs,
		async run(args, { env = {} } = {}) {
			let stdout = "";
			let stderr = "";
			const exitCode = await main(args, {
				env: {
					SPROUT_ROOT: root,
					HOME: home,
					XDG_CONFIG_HOME: join(home, ".config"),
					PATH: process.env.PATH,
					...env,
				},
				stdout: {
					write: (text) => {
						stdout += text;
					},
				},
				stderr: {
					write: (text) => {
						stderr += text;
					},
				},
				programs,
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
appendFileSync(${JSON.stringify(callLog(bin, name))}, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdout.write(${JSON.stringify(behavior.stdout ?? "")});
process.stderr.write(${JSON.stringify(behavior.stderr ?? "")});
process.exitCode = ${behavior.exitCode ?? 0};
`,
	);
	await chmod(path, 0o755);
	return path;
}

function callLog(bin: string, name: ProgramName): string {
	return join(bin, `${name}.calls`);
}
