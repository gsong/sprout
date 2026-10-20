import { expect, test } from "bun:test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	addExperiment,
	createHarness,
	type FakeProgram,
	type FakeReply,
} from "./harness.ts";

const trashWorks = { fakes: { trash: {} } };

const project = "2026-10-10-bun-sqlite-bench-claude";
const image = `${project}:latest`;
const volume = `${project}_claude-config`;
const network = `${project}_default`;
const dockerLine = `Docker: image ${image}, volume ${volume}, network ${network}\n`;

const listImage = ["image", "ls", "--quiet", image];
const listVolume = ["volume", "ls", "--quiet", "--filter", `name=${volume}`];
const listNetwork = [
	"network",
	"ls",
	"--format",
	"{{.Name}}",
	"--filter",
	`name=${network}`,
];
const removeImage = ["image", "rm", image];
const removeVolume = ["volume", "rm", volume];
const removeNetwork = ["network", "rm", network];

/** Docker's replies when it holds the experiment's image, volume, and network. */
const allPresent: FakeReply[] = [
	{ args: listImage, stdout: "3f2a9c1b7d4e\n" },
	// The name filter also matches names that only contain it.
	{ args: listVolume, stdout: `${volume}-old\n${volume}\n` },
	{ args: listNetwork, stdout: `${network}\n` },
];
const dockerHasAll: FakeProgram = { replies: allPresent };

/** Writes `docker/kit.toml` in the experiment `dirName` under `root`. */
async function writeKit(root: string, dirName: string, text: string) {
	await mkdir(join(root, dirName, "docker"), { recursive: true });
	await writeFile(join(root, dirName, "docker", "kit.toml"), text);
}

/** Adds the containerized experiment `2026-10-10-bun-sqlite-bench`. */
async function addContainerized(root: string): Promise<string> {
	const dirName = "2026-10-10-bun-sqlite-bench";
	await addExperiment(
		root,
		dirName,
		"# bun-sqlite-bench\n\nBench SQLite in Bun\n",
	);
	await writeKit(root, dirName, `project_name = "${project}"\n`);
	return join(root, dirName);
}

function dockerWith(
	docker: FakeProgram,
	trash: FakeProgram = {},
): { fakes: { trash: FakeProgram; docker: FakeProgram } } {
	return { fakes: { trash, docker } };
}

test("rm shows the experiment, and on yes moves it to the Trash", async () => {
	await using harness = await createHarness(trashWorks);
	await addExperiment(
		harness.root,
		"2026-10-10-bun-sqlite-bench",
		"# bun-sqlite-bench\n\nBench SQLite in Bun\n",
	);
	await addExperiment(harness.root, "2026-10-09-deno-kv");
	const path = join(harness.root, "2026-10-10-bun-sqlite-bench");

	const result = await harness.run(["rm", "sqlite"], { stdin: "y\n" });

	expect(result).toEqual({
		exitCode: 0,
		stdout: "",
		stderr: `${path}\nBench SQLite in Bun\nRemove? [y/N] `,
	});
	expect((await harness.calls("trash")).map((call) => call.args)).toEqual([
		[path],
	]);
});

test.each(["y\n", "Y\n", " yes \n", "YES\n"])(
	"rm takes %j as yes",
	async (stdin) => {
		await using harness = await createHarness(trashWorks);
		await addExperiment(harness.root, "idea");

		const result = await harness.run(["rm", "idea"], { stdin });

		expect(result.exitCode).toBe(0);
		expect(await harness.calls("trash")).toHaveLength(1);
	},
);

// After an answer, the terminal has already echoed the line ending.
test.each([
	["an empty answer", "\n", ""],
	["n", "n\n", ""],
	["yep", "yep\n", ""],
	["end of input", "", "\n"],
])(
	"%s at Remove? cancels, exits 1, and removes nothing",
	async (_, stdin, lineEnd) => {
		await using harness = await createHarness(trashWorks);
		await addExperiment(harness.root, "idea");

		const result = await harness.run(["rm", "idea"], { stdin });

		expect(result).toEqual({
			exitCode: 1,
			stdout: "",
			stderr: `${join(harness.root, "idea")}\nRemove? [y/N] ${lineEnd}sprout: cancelled\n`,
		});
		expect(await harness.calls("trash")).toEqual([]);
	},
);

test.each([
	["one match", ["rm", "idea"]],
	["several matches", ["rm"]],
])(
	"with no terminal attached, rm exits 1 and removes nothing (%s)",
	async (_, args) => {
		await using harness = await createHarness(trashWorks);
		await addExperiment(harness.root, "idea");
		await addExperiment(harness.root, "2026-10-09-deno-kv");

		const result = await harness.run(args);

		expect(result).toEqual({
			exitCode: 1,
			stdout: "",
			stderr: "sprout: rm needs a terminal to confirm\n",
		});
		expect(await harness.calls("trash")).toEqual([]);
	},
);

test("rm exits 1 with trash's error when trash fails", async () => {
	await using harness = await createHarness({
		fakes: {
			trash: { stderr: "trash: permission denied\n", exitCode: 1 },
		},
	});
	await addExperiment(harness.root, "idea");
	const path = join(harness.root, "idea");

	const result = await harness.run(["rm", "idea"], { stdin: "y\n" });

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: `${path}\nRemove? [y/N] sprout: could not move ${path} to the Trash: trash: permission denied\n`,
	});
});

test("rm exits 1 when trash cannot run", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "idea");
	const path = join(harness.root, "idea");
	const missing = join(harness.root, "..", "no-such-trash");

	const result = await harness.run(["rm", "idea"], {
		stdin: "y\n",
		programs: { trash: missing },
	});

	expect(result.exitCode).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toStartWith(
		`${path}\nRemove? [y/N] sprout: could not move ${path} to the Trash: `,
	);
});

test("rm with no query picks from every experiment, then asks", async () => {
	await using harness = await createHarness(trashWorks);
	await addExperiment(harness.root, "2026-10-10-bun-sqlite-bench");
	await addExperiment(
		harness.root,
		"2026-10-09-deno-kv",
		"# deno-kv\n\nTry Deno KV\n",
	);
	const path = join(harness.root, "2026-10-09-deno-kv");

	const result = await harness.run(["rm"], { stdin: "2\nyes\n" });

	expect(result).toEqual({
		exitCode: 0,
		stdout: "",
		stderr:
			"1) 2026-10-10-bun-sqlite-bench\n" +
			"2) 2026-10-09-deno-kv  Try Deno KV\n" +
			"Number [1-2]: " +
			`${path}\nTry Deno KV\nRemove? [y/N] `,
	});
	expect((await harness.calls("trash")).map((call) => call.args)).toEqual([
		[path],
	]);
});

test("an empty answer at the pick list cancels rm before it asks to remove", async () => {
	await using harness = await createHarness(trashWorks);
	await addExperiment(harness.root, "2026-10-10-bun-sqlite-bench");
	await addExperiment(harness.root, "2026-10-09-deno-kv");

	const result = await harness.run(["rm"], { stdin: "\ny\n" });

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toEndWith("Number [1-2]: sprout: cancelled\n");
	expect(await harness.calls("trash")).toEqual([]);
});

test("rm exits 1 when no experiment matches", async () => {
	await using harness = await createHarness(trashWorks);
	await addExperiment(harness.root, "idea");

	const result = await harness.run(["rm", "deno"], { stdin: "y\n" });

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: "sprout: no experiment matches 'deno'\n",
	});
});

test("Ctrl-C at Remove? exits 130 and removes nothing", async () => {
	await using harness = await createHarness(trashWorks);
	await addExperiment(harness.root, "idea");
	const stdin = new PassThrough();

	const result = await harness.run(["rm", "idea"], {
		stdin,
		interruptAt: "Remove? [y/N] ",
	});
	stdin.end();

	expect(result).toEqual({
		exitCode: 130,
		stdout: "",
		stderr: `${join(harness.root, "idea")}\nRemove? [y/N] \n`,
	});
	expect(await harness.calls("trash")).toEqual([]);
});

test("rm with more than one query is a usage error", async () => {
	await using harness = await createHarness(trashWorks);

	const result = await harness.run(["rm", "bun", "sqlite"]);

	expect(result).toEqual({
		exitCode: 2,
		stdout: "",
		stderr:
			"sprout: rm takes at most one query\nRun 'sprout --help' for usage.\n",
	});
});

test("rm names the Docker objects, and on yes trashes the directory, then removes them", async () => {
	await using harness = await createHarness(dockerWith(dockerHasAll));
	const path = await addContainerized(harness.root);
	const claudeProject = join(harness.home, ".claude", "projects", "-x");
	await mkdir(claudeProject, { recursive: true });

	const result = await harness.run(["rm", "sqlite"], { stdin: "y\n" });

	expect(result).toEqual({
		exitCode: 0,
		stdout: "",
		stderr: `${path}\nBench SQLite in Bun\n${dockerLine}Remove? [y/N] `,
	});
	expect((await harness.calls("trash")).map((call) => call.args)).toEqual([
		[path],
	]);
	expect((await harness.calls("docker")).map((call) => call.args)).toEqual([
		listImage,
		listVolume,
		listNetwork,
		removeImage,
		removeVolume,
		removeNetwork,
	]);
	expect(await readdir(join(harness.home, ".claude", "projects"))).toEqual([
		"-x",
	]);
});

test("rm skips the Docker objects that are missing", async () => {
	await using harness = await createHarness(
		dockerWith({
			replies: [
				{ args: listVolume, stdout: `${volume}-old\n` },
				{ args: listNetwork, stdout: `${network}\n` },
			],
		}),
	);
	await addContainerized(harness.root);

	const result = await harness.run(["rm", "sqlite"], { stdin: "y\n" });

	expect(result.exitCode).toBe(0);
	expect(result.stderr).toEndWith(`${dockerLine}Remove? [y/N] `);
	expect((await harness.calls("docker")).map((call) => call.args)).toEqual([
		listImage,
		listVolume,
		listNetwork,
		removeNetwork,
	]);
});

test("rm skips Docker removal when another experiment has the same project_name", async () => {
	await using harness = await createHarness(dockerWith(dockerHasAll));
	const path = await addContainerized(harness.root);
	await writeKit(harness.root, "bun-copy", `project_name = "${project}"\n`);
	await writeKit(harness.root, "2026-10-09-deno-kv", 'project_name = "x"\n');

	const result = await harness.run(["rm", "sqlite"], { stdin: "y\n" });

	expect(result).toEqual({
		exitCode: 0,
		stdout: "",
		stderr:
			`${path}\nBench SQLite in Bun\n${dockerLine}Remove? [y/N] ` +
			`sprout: skipped Docker removal: bun-copy also has project_name "${project}"\n`,
	});
	expect(await harness.calls("trash")).toHaveLength(1);
	expect(await harness.calls("docker")).toEqual([]);
});

test("rm warns once and exits 0 when docker is not installed", async () => {
	await using harness = await createHarness(trashWorks);
	await addContainerized(harness.root);

	const result = await harness.run(["rm", "sqlite"], {
		stdin: "y\n",
		programs: { docker: "sprout-test-no-such-docker" },
	});

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toBe("");
	expect(result.stderr).toEndWith(
		`${dockerLine}Remove? [y/N] sprout: Docker removal failed: sprout-test-no-such-docker is not on PATH\n`,
	);
	expect(await harness.calls("trash")).toHaveLength(1);
});

test("rm warns once and exits 0 when the Docker daemon is stopped", async () => {
	await using harness = await createHarness(
		dockerWith({
			stderr:
				"Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n",
			exitCode: 1,
		}),
	);
	await addContainerized(harness.root);

	const result = await harness.run(["rm", "sqlite"], { stdin: "y\n" });

	expect(result.exitCode).toBe(0);
	expect(result.stderr).toEndWith(
		`${dockerLine}Remove? [y/N] sprout: Docker removal failed: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n`,
	);
	expect((await harness.calls("docker")).map((call) => call.args)).toEqual([
		listImage,
	]);
});

test("rm warns once and exits 0 when docker cannot remove an object", async () => {
	await using harness = await createHarness(
		dockerWith({
			replies: [
				...allPresent,
				{
					args: removeImage,
					stderr: `Error response from daemon: conflict: unable to remove repository reference "${image}" (must force) - container 1a2b is using its referenced image 3f2a9c1b7d4e\n`,
					exitCode: 1,
				},
			],
		}),
	);
	await addContainerized(harness.root);

	const result = await harness.run(["rm", "sqlite"], { stdin: "y\n" });

	expect(result.exitCode).toBe(0);
	expect(result.stderr).toEndWith(
		`${dockerLine}Remove? [y/N] sprout: Docker removal failed: Error response from daemon: conflict: unable to remove repository reference "${image}" (must force) - container 1a2b is using its referenced image 3f2a9c1b7d4e\n`,
	);
});

test.each([
	["no project_name", 'image = "x"\n'],
	["a project_name that is not text", "project_name = 3\n"],
	["a project_name that docker would reject", 'project_name = "--all"\n'],
	["TOML that does not parse", "project_name = \n"],
])("rm leaves Docker alone when docker/kit.toml holds %s", async (_, kit) => {
	await using harness = await createHarness(dockerWith(dockerHasAll));
	await addExperiment(harness.root, "idea");
	await writeKit(harness.root, "idea", kit);

	const result = await harness.run(["rm", "idea"], { stdin: "y\n" });

	expect(result).toEqual({
		exitCode: 0,
		stdout: "",
		stderr: `${join(harness.root, "idea")}\nRemove? [y/N] `,
	});
	expect(await harness.calls("trash")).toHaveLength(1);
	expect(await harness.calls("docker")).toEqual([]);
});

test("declining rm leaves the directory and Docker alone", async () => {
	await using harness = await createHarness(dockerWith(dockerHasAll));
	await addContainerized(harness.root);

	const result = await harness.run(["rm", "sqlite"], { stdin: "n\n" });

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toEndWith(
		`${dockerLine}Remove? [y/N] sprout: cancelled\n`,
	);
	expect(await harness.calls("trash")).toEqual([]);
	expect(await harness.calls("docker")).toEqual([]);
});

test("rm leaves Docker alone when trash fails", async () => {
	await using harness = await createHarness(
		dockerWith(dockerHasAll, {
			stderr: "trash: permission denied\n",
			exitCode: 1,
		}),
	);
	await addContainerized(harness.root);

	const result = await harness.run(["rm", "sqlite"], { stdin: "y\n" });

	expect(result.exitCode).toBe(1);
	expect(await harness.calls("docker")).toEqual([]);
});

test("Ctrl-C while docker runs stops it and exits 130", async () => {
	await using harness = await createHarness(trashWorks);
	await addContainerized(harness.root);
	const marker = join(harness.home, "docker-running");
	const docker = join(harness.home, "slow-docker");
	await writeFile(docker, `#!/bin/sh\ntouch '${marker}'\nexec sleep 5\n`, {
		mode: 0o755,
	});
	const ctrlC = new AbortController();

	const running = harness.run(["rm", "sqlite"], {
		stdin: "y\n",
		programs: { docker },
		signal: ctrlC.signal,
	});
	while (!(await Bun.file(marker).exists())) await Bun.sleep(10);
	ctrlC.abort();
	const result = await running;

	expect(result.exitCode).toBe(130);
	expect(result.stderr).toEndWith(`${dockerLine}Remove? [y/N] \n`);
});

test("rm names the Docker objects of an experiment new made with containerized Claude Code", async () => {
	await using harness = await createHarness({
		fakes: { claude: { stdout: "bun-sqlite-bench\n" }, trash: {}, docker: {} },
	});
	const made = await harness.run(["new", "Bench SQLite in Bun"], {
		stdin: "\ny\n",
	});
	expect(made.exitCode).toBe(0);

	const result = await harness.run(["rm", "sqlite"], { stdin: "y\n" });

	expect(result.exitCode).toBe(0);
	expect(result.stderr).toEndWith(
		"Docker: image bun-sqlite-bench-claude:latest, volume bun-sqlite-bench-claude_claude-config, network bun-sqlite-bench-claude_default\nRemove? [y/N] ",
	);
});
