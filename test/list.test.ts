import { expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addExperiment, createHarness } from "./harness.ts";

test("list prints each experiment and its description, newest first", async () => {
	await using harness = await createHarness();
	await addExperiment(
		harness.root,
		"2026-01-05-older-idea",
		"# older-idea\n\nAn older idea\n",
	);
	await addExperiment(
		harness.root,
		"2026-10-10-bun-sqlite-bench",
		"# bun-sqlite-bench\n\nBench SQLite in Bun\n",
	);

	const result = await harness.run(["list"]);

	expect(result).toEqual({
		exitCode: 0,
		stdout:
			"2026-10-10-bun-sqlite-bench  Bench SQLite in Bun\n2026-01-05-older-idea  An older idea\n",
		stderr: "",
	});
});

test("on a terminal, list bolds each name and puts a blank line between experiments", async () => {
	await using harness = await createHarness();
	await addExperiment(
		harness.root,
		"2026-01-05-older-idea",
		"# older-idea\n\nAn older idea\n",
	);
	await addExperiment(harness.root, "2026-10-10-no-readme");

	const result = await harness.run(["list"], { stdoutTerminal: true });

	expect(result.stdout).toBe(
		"\x1b[1m2026-10-10-no-readme\x1b[22m\n\n\x1b[1m2026-01-05-older-idea\x1b[22m  An older idea\n",
	);
});

test("on a terminal with NO_COLOR set, list keeps the blank lines but drops the bold", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-01-05-older-idea");
	await addExperiment(harness.root, "2026-10-10-newer-idea");

	const result = await harness.run(["list"], {
		stdoutTerminal: true,
		env: { NO_COLOR: "1" },
	});

	expect(result.stdout).toBe(
		"2026-10-10-newer-idea\n\n2026-01-05-older-idea\n",
	);
});

test("an experiment with no README shows the directory name alone", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-10-no-readme");

	const result = await harness.run(["list"]);

	expect(result.stdout).toBe("2026-10-10-no-readme\n");
});

test.each([
	[
		"skips text before the heading",
		"Intro\n# idea\n\n\n  The idea  \nMore\n",
		"The idea",
	],
	["needs a heading", "Just text\n", undefined],
	["needs a line after the heading", "# idea\n\n", undefined],
	["needs a space after the #", "#hashtag\n# idea\n\nThe idea\n", "The idea"],
])("the description %s", async (_, readme, description) => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-10-idea", readme);

	const result = await harness.run(["list"]);

	expect(result.stdout).toBe(
		description === undefined
			? "2026-10-10-idea\n"
			: `2026-10-10-idea  ${description}\n`,
	);
});

test("hidden directories and files are not experiments", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-10-idea");
	await addExperiment(harness.root, ".git");
	await writeFile(join(harness.root, "notes.txt"), "not an experiment\n");

	const result = await harness.run(["list"]);

	expect(result.stdout).toBe("2026-10-10-idea\n");
});

test("list sorts by modified time, newest first, then by name descending", async () => {
	await using harness = await createHarness();
	const added: [string, Date][] = [
		["alpha", new Date(2026, 9, 12)],
		["2026-10-10-dated", new Date(2026, 0, 1)],
		["zeta", new Date(2026, 0, 1)],
		["2026-01-05-touched", new Date(2026, 9, 11)],
		["beta", new Date(2026, 0, 1)],
	];
	for (const [dirName, modified] of added) {
		await addExperiment(harness.root, dirName, undefined, modified);
	}

	const result = await harness.run(["list"]);

	expect(result.stdout).toBe(
		"alpha\n2026-01-05-touched\nzeta\nbeta\n2026-10-10-dated\n",
	);
});

test("the filter keeps directory names that contain it, ignoring case", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-10-bun-sqlite-bench");
	await addExperiment(
		harness.root,
		"2026-10-09-deno-kv",
		"# deno-kv\n\nSQLite-ish KV\n",
	);
	await addExperiment(harness.root, "SQLite-notes");

	const result = await harness.run(["list", "sqlITE"]);

	expect(result.stdout).toBe("SQLite-notes\n2026-10-10-bun-sqlite-bench\n");
});

test("a missing root prints nothing and exits 0", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["list"], {
		env: { SPROUT_ROOT: join(harness.root, "missing") },
	});

	expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("list with more than one filter is a usage error", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["list", "bun", "sqlite"]);

	expect(result).toEqual({
		exitCode: 2,
		stdout: "",
		stderr:
			"sprout: list takes at most one filter\nRun 'sprout --help' for usage.\n",
	});
});

test("a symlink to a directory is an experiment", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.home, "elsewhere", "# elsewhere\n\nLinked in\n");
	await symlink(
		join(harness.home, "elsewhere"),
		join(harness.root, "2026-10-10-linked"),
	);

	const result = await harness.run(["list"]);

	expect(result.stdout).toBe("2026-10-10-linked  Linked in\n");
});

test("a README.md that is a directory gives no description", async () => {
	await using harness = await createHarness();
	await mkdir(join(harness.root, "2026-10-10-idea/README.md"), {
		recursive: true,
	});

	const result = await harness.run(["list"]);

	expect(result).toEqual({
		exitCode: 0,
		stdout: "2026-10-10-idea\n",
		stderr: "",
	});
});
