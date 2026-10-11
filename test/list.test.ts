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

test("undated directories come after dated ones, by name descending", async () => {
	await using harness = await createHarness();
	for (const dirName of [
		"alpha",
		"2026-01-05-older",
		"zeta",
		"2026-1-bad",
		"2026-10-10-newer",
	]) {
		await addExperiment(harness.root, dirName);
	}

	const result = await harness.run(["list"]);

	expect(result.stdout).toBe(
		"2026-10-10-newer\n2026-01-05-older\nzeta\nalpha\n2026-1-bad\n",
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

	expect(result.stdout).toBe("2026-10-10-bun-sqlite-bench\nSQLite-notes\n");
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
