import { expect, test } from "bun:test";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { addExperiment, createHarness } from "./harness.ts";

const trashWorks = { fakes: { trash: {} } };

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
