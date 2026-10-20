import { expect, test } from "bun:test";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { addExperiment, createHarness } from "./harness.ts";

test("open prints the path of the one experiment that matches, ignoring case", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-10-bun-sqlite-bench");
	await addExperiment(harness.root, "2026-10-09-deno-kv");

	const result = await harness.run(["open", "SQLite"]);

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, "2026-10-10-bun-sqlite-bench")}\n`,
		stderr: "",
	});
});

test("open exits 1 when no experiment matches", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-10-bun-sqlite-bench");

	const result = await harness.run(["open", "deno"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: "sprout: no experiment matches 'deno'\n",
	});
});

test("a missing root has no experiments to open", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["open", "idea"], {
		env: { SPROUT_ROOT: join(harness.root, "missing") },
	});

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: "sprout: no experiment matches 'idea'\n",
	});
});

test("several matches show a numbered pick list on stderr, in list order", async () => {
	await using harness = await createHarness();
	await addExperiment(
		harness.root,
		"2026-01-05-sqlite-old",
		"# sqlite-old\n\nOld try\n",
		new Date(2026, 0, 5),
	);
	await addExperiment(
		harness.root,
		"2026-10-10-bun-sqlite-bench",
		"# bun-sqlite-bench\n\nBench SQLite in Bun\n",
		new Date(2026, 9, 10),
	);
	await addExperiment(
		harness.root,
		"sqlite-notes",
		undefined,
		new Date(2025, 11, 31),
	);
	await addExperiment(harness.root, "2026-10-09-deno-kv");

	const result = await harness.run(["open", "sqlite"], { stdin: "2\n" });

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, "2026-01-05-sqlite-old")}\n`,
		stderr:
			"1) 2026-10-10-bun-sqlite-bench  Bench SQLite in Bun\n" +
			"2) 2026-01-05-sqlite-old  Old try\n" +
			"3) sqlite-notes\n" +
			"Number [1-3]: ",
	});
});

async function addThree(root: string): Promise<void> {
	await addExperiment(root, "2026-10-10-bun-sqlite-bench");
	await addExperiment(root, "2026-10-09-deno-kv");
	await addExperiment(root, "2026-01-05-sqlite-old");
}

const pickList =
	"1) 2026-10-10-bun-sqlite-bench\n" +
	"2) 2026-10-09-deno-kv\n" +
	"3) 2026-01-05-sqlite-old\n";

test("an invalid answer asks for the number again", async () => {
	await using harness = await createHarness();
	await addThree(harness.root);

	const result = await harness.run(["open"], { stdin: "0\n4\ntwo\n-1\n 3 \n" });

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, "2026-01-05-sqlite-old")}\n`,
		stderr: pickList + "Number [1-3]: ".repeat(5),
	});
});

// After an empty answer, the terminal has already echoed the line ending.
test.each([
	["an empty answer", "  \n2\n", ""],
	["end of input", "", "\n"],
])("%s at the pick list cancels and exits 1", async (_, stdin, lineEnd) => {
	await using harness = await createHarness();
	await addThree(harness.root);

	const result = await harness.run(["open"], { stdin });

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: `${pickList}Number [1-3]: ${lineEnd}sprout: cancelled\n`,
	});
});

test("Ctrl-C at the pick list exits 130", async () => {
	await using harness = await createHarness();
	await addThree(harness.root);
	const stdin = new PassThrough();

	const result = await harness.run(["open"], {
		stdin,
		interruptAt: "Number [1-3]: ",
	});
	stdin.end();

	expect(result).toEqual({
		exitCode: 130,
		stdout: "",
		stderr: `${pickList}Number [1-3]: \n`,
	});
});

test("several matches with no terminal attached exit 1", async () => {
	await using harness = await createHarness();
	await addThree(harness.root);

	const result = await harness.run(["open", "sqlite"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr:
			"sprout: 'sqlite' matches 2 experiments; pick one in a terminal or use a longer query\n",
	});
});

test("open with no query picks from every experiment", async () => {
	await using harness = await createHarness();
	await addThree(harness.root);

	const result = await harness.run(["open"], { stdin: "2\n" });

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, "2026-10-09-deno-kv")}\n`,
		stderr: `${pickList}Number [1-3]: `,
	});
});

test("open with no query and one experiment opens it without asking", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "idea");

	const result = await harness.run(["open"]);

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, "idea")}\n`,
		stderr: "",
	});
});

test("open with no query and no experiments exits 1", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["open"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: `sprout: no experiments in ${harness.root}\n`,
	});
});

test("open with no query and no terminal attached exits 1 when several exist", async () => {
	await using harness = await createHarness();
	await addThree(harness.root);

	const result = await harness.run(["open"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr:
			"sprout: 3 experiments exist; pick one in a terminal or give a query\n",
	});
});

test("pick list numbers line up past nine", async () => {
	await using harness = await createHarness();
	for (let day = 1; day <= 10; day++) {
		await addExperiment(
			harness.root,
			`2026-10-${String(day).padStart(2, "0")}-idea`,
		);
	}

	const result = await harness.run(["open"], { stdin: "10\n" });

	expect(result.stdout).toBe(`${join(harness.root, "2026-10-01-idea")}\n`);
	expect(result.stderr).toStartWith(
		" 1) 2026-10-10-idea\n 2) 2026-10-09-idea\n",
	);
	expect(result.stderr).toEndWith("10) 2026-10-01-idea\nNumber [1-10]: ");
});

test("open with more than one query is a usage error", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["open", "bun", "sqlite"]);

	expect(result).toEqual({
		exitCode: 2,
		stdout: "",
		stderr:
			"sprout: open takes at most one query\nRun 'sprout --help' for usage.\n",
	});
});
