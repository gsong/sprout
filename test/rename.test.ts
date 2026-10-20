import { expect, test } from "bun:test";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { addExperiment, claudeSays, createHarness, gitIn } from "./harness.ts";

/** Adds two experiments that the query `sqlite` both matches. */
async function addTwoSqlite(root: string): Promise<void> {
	await addExperiment(root, "2026-10-10-bun-sqlite-bench");
	await addExperiment(root, "2026-01-05-sqlite-old");
}

/** The README of the experiment `dirName` under `root`. */
function readReadme(root: string, dirName: string): Promise<string> {
	return readFile(join(root, dirName, "README.md"), "utf8");
}

test("rename keeps a dated experiment's date, rewrites its heading, and prints the new path", async () => {
	await using harness = await createHarness();
	await addExperiment(
		harness.root,
		"2026-10-09-bun-sqlite-bench",
		"# bun-sqlite-bench\n\nBench SQLite in Bun\n",
	);
	const path = join(harness.root, "2026-10-09-sqlite-speed");

	const result = await harness.run(["rename", "bench", "SQLite", "speed!"]);

	expect(result).toEqual({ exitCode: 0, stdout: `${path}\n`, stderr: "" });
	expect(await readdir(harness.root)).toEqual(["2026-10-09-sqlite-speed"]);
	expect(await readReadme(harness.root, "2026-10-09-sqlite-speed")).toBe(
		"# sqlite-speed\n\nBench SQLite in Bun\n",
	);
});

test.each([
	["no arguments", []],
	["only a query", ["bench"]],
])("rename with %s is a usage error", async (_, args) => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-09-bun-sqlite-bench");

	const result = await harness.run(["rename", ...args]);

	expect(result).toEqual({
		exitCode: 2,
		stdout: "",
		stderr:
			"sprout: rename needs a query and a new name\nRun 'sprout --help' for usage.\n",
	});
	expect(await readdir(harness.root)).toEqual(["2026-10-09-bun-sqlite-bench"]);
});

test("rename gives an undated experiment the bare new name", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "scratch-notes");

	const result = await harness.run(["rename", "scratch", "sqlite", "notes"]);

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, "sqlite-notes")}\n`,
		stderr: "",
	});
	expect(await readdir(harness.root)).toEqual(["sqlite-notes"]);
	expect(await readdir(join(harness.root, "sqlite-notes"))).toEqual([]);
});

test.each([
	["an edited heading", "# Bun SQLite bench\n\nBench SQLite in Bun\n"],
	["a longer heading", "# bun-sqlite-bench v2\n\nBench SQLite in Bun\n"],
	["a deeper heading", "## bun-sqlite-bench\n\nBench SQLite in Bun\n"],
	["the old name under another heading", "# Notes\n\n# bun-sqlite-bench\n"],
])("rename leaves a README with %s alone", async (_, readme) => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-09-bun-sqlite-bench", readme);

	const result = await harness.run(["rename", "bench", "sqlite-speed"]);

	expect(result.exitCode).toBe(0);
	expect(await readReadme(harness.root, "2026-10-09-sqlite-speed")).toBe(
		readme,
	);
});

test("rename rewrites only the first heading", async () => {
	await using harness = await createHarness();
	await addExperiment(
		harness.root,
		"2026-10-09-bun-sqlite-bench",
		"# bun-sqlite-bench\n\nBench SQLite in Bun\n\n# bun-sqlite-bench\n",
	);

	await harness.run(["rename", "bench", "sqlite-speed"]);

	expect(await readReadme(harness.root, "2026-10-09-sqlite-speed")).toBe(
		"# sqlite-speed\n\nBench SQLite in Bun\n\n# bun-sqlite-bench\n",
	);
});

test("renaming onto an existing directory exits 1 and changes nothing", async () => {
	await using harness = await createHarness();
	await addExperiment(
		harness.root,
		"2026-10-09-bun-sqlite-bench",
		"# bun-sqlite-bench\n\nBench SQLite in Bun\n",
	);
	await addExperiment(harness.root, "2026-10-09-sqlite-speed");
	const target = join(harness.root, "2026-10-09-sqlite-speed");

	const result = await harness.run(["rename", "bench", "sqlite-speed"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: `sprout: ${target} already exists\n`,
	});
	expect((await readdir(harness.root)).sort()).toEqual([
		"2026-10-09-bun-sqlite-bench",
		"2026-10-09-sqlite-speed",
	]);
	expect(await readdir(target)).toEqual([]);
	expect(await readReadme(harness.root, "2026-10-09-bun-sqlite-bench")).toBe(
		"# bun-sqlite-bench\n\nBench SQLite in Bun\n",
	);
});

test("renaming onto an existing file exits 1", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "scratch");
	await writeFile(join(harness.root, "notes"), "");

	const result = await harness.run(["rename", "scratch", "notes"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: `sprout: ${join(harness.root, "notes")} already exists\n`,
	});
	expect((await readdir(harness.root)).sort()).toEqual(["notes", "scratch"]);
});

test("renaming an experiment to its own name exits 1", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-09-bun-sqlite-bench");
	const path = join(harness.root, "2026-10-09-bun-sqlite-bench");

	const result = await harness.run(["rename", "bench", "bun-sqlite-bench"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: `sprout: ${path} already exists\n`,
	});
});

// On a case-insensitive file system, such as macOS by default, the new name
// finds the experiment itself.
test("rename can change only the case of an undated directory", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "Scratch", "# Scratch\n\nTry things\n");

	const result = await harness.run(["rename", "scratch", "scratch"]);

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, "scratch")}\n`,
		stderr: "",
	});
	expect(await readdir(harness.root)).toEqual(["scratch"]);
	expect(await readReadme(harness.root, "scratch")).toBe(
		"# scratch\n\nTry things\n",
	);
});

test("rename makes no commit, never asks Claude, and leaves kit.toml alone", async () => {
	await using harness = await createHarness(claudeSays("bun-sqlite-bench"));
	const created = await harness.run(["new", "Bench SQLite in Bun"], {
		stdin: "\ny\n",
	});
	const kit = `project_name = "bun-sqlite-bench-claude"\n`;
	const path = join(harness.root, `sqlite-speed`);

	const result = await harness.run(["rename", "bench", "sqlite", "speed"]);

	expect(created.exitCode).toBe(0);
	expect(result).toEqual({ exitCode: 0, stdout: `${path}\n`, stderr: "" });
	expect(await harness.calls("claude")).toHaveLength(1);
	expect(await readFile(join(path, "docker/kit.toml"), "utf8")).toBe(kit);
	const git = gitIn(path, harness.home);
	expect(git("log", "--format=%s")).toBe("chore: start experiment\n");
	expect(git("status", "--porcelain")).toBe(" M README.md\n");
});

test("rename picks from several matches the way open does", async () => {
	await using harness = await createHarness();
	await addTwoSqlite(harness.root);

	const result = await harness.run(["rename", "sqlite", "sqlite-first"], {
		stdin: "2\n",
	});

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, "2026-01-05-sqlite-first")}\n`,
		stderr:
			"1) 2026-10-10-bun-sqlite-bench\n" +
			"2) 2026-01-05-sqlite-old\n" +
			"Number [1-2]: ",
	});
	expect((await readdir(harness.root)).sort()).toEqual([
		"2026-01-05-sqlite-first",
		"2026-10-10-bun-sqlite-bench",
	]);
});

test("rename with several matches and no terminal attached exits 1", async () => {
	await using harness = await createHarness();
	await addTwoSqlite(harness.root);

	const result = await harness.run(["rename", "sqlite", "sqlite-first"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr:
			"sprout: 'sqlite' matches 2 experiments; pick one in a terminal or use a longer query\n",
	});
});

test("rename exits 1 when no experiment matches", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-10-bun-sqlite-bench");

	const result = await harness.run(["rename", "deno", "deno-kv"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: "sprout: no experiment matches 'deno'\n",
	});
});

test("a missing root has no experiments to rename", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["rename", "idea", "better"], {
		env: { SPROUT_ROOT: join(harness.root, "missing") },
	});

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: "sprout: no experiment matches 'idea'\n",
	});
});

test("end of input at the pick list cancels the rename", async () => {
	await using harness = await createHarness();
	await addTwoSqlite(harness.root);

	const result = await harness.run(["rename", "sqlite", "sqlite-first"], {
		stdin: "",
	});

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toEndWith("Number [1-2]: \nsprout: cancelled\n");
	expect((await readdir(harness.root)).sort()).toEqual([
		"2026-01-05-sqlite-old",
		"2026-10-10-bun-sqlite-bench",
	]);
});

test("Ctrl-C at the pick list exits 130 and renames nothing", async () => {
	await using harness = await createHarness();
	await addTwoSqlite(harness.root);
	const stdin = new PassThrough();

	const result = await harness.run(["rename", "sqlite", "sqlite-first"], {
		stdin,
		interruptAt: "Number [1-2]: ",
	});
	stdin.end();

	expect(result.exitCode).toBe(130);
	expect((await readdir(harness.root)).sort()).toEqual([
		"2026-01-05-sqlite-old",
		"2026-10-10-bun-sqlite-bench",
	]);
});

test("a new name with no a-z or 0-9 exits 1 before picking", async () => {
	await using harness = await createHarness();
	await addTwoSqlite(harness.root);

	const result = await harness.run(["rename", "sqlite", "日本語"], {
		stdin: "1\n",
	});

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: "sprout: '日本語' has no a-z or 0-9 to make a name from\n",
	});
});

test("a new name over 40 characters is cut at a dash", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-10-idea");

	const result = await harness.run([
		"rename",
		"idea",
		"a very long experiment name that goes past forty characters",
	]);

	expect(result.stdout).toBe(
		`${join(harness.root, "2026-10-10-a-very-long-experiment-name-that-goes")}\n`,
	);
});

test("a README sprout cannot rewrite moves the experiment back and exits 1", async () => {
	await using harness = await createHarness();
	await addExperiment(
		harness.root,
		"2026-10-09-bun-sqlite-bench",
		"# bun-sqlite-bench\n\nBench SQLite in Bun\n",
	);
	await chmod(
		join(harness.root, "2026-10-09-bun-sqlite-bench", "README.md"),
		0o444,
	);

	const result = await harness.run(["rename", "bench", "sqlite-speed"]);

	expect(result.exitCode).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toStartWith(
		`sprout: ${join(harness.root, "2026-10-09-sqlite-speed", "README.md")}: `,
	);
	expect(await readdir(harness.root)).toEqual(["2026-10-09-bun-sqlite-bench"]);
});
