import { expect, test } from "bun:test";
import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { addExperiment, createHarness, gitUser, today } from "./harness.ts";

test("new creates <date>-<name> under the root and prints only its path", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["new", "Bun", "+", "SQLite", "bench!"]);

	const path = join(harness.root, `${today}-bun-sqlite-bench`);
	expect(result).toEqual({ exitCode: 0, stdout: `${path}\n`, stderr: "" });
	expect(await Bun.file(join(path, "README.md")).exists()).toBe(true);
});

test("the README holds the name as a heading and the description word for word", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["new", "Bun  +", "SQLite bench!"]);

	expect(await readme(result.stdout)).toBe(
		"# bun-sqlite-bench\n\nBun  + SQLite bench!\n",
	);
});

test.each([
	["Café crème test", "cafe-creme-test"],
	["--Hello__World--", "hello-world"],
	["ﬁle Ⅻ", "file-xii"],
	[
		"alpha bravo charlie delta echo foxtrot golf",
		"alpha-bravo-charlie-delta-echo-foxtrot",
	],
	["a".repeat(45), "a".repeat(40)],
	[`abc ${"d".repeat(36)} e`, `abc-${"d".repeat(36)}`],
])("the name of %p is %p", async (description, name) => {
	await using harness = await createHarness();

	const result = await harness.run(["new", description]);

	expect(result.stdout).toBe(`${join(harness.root, `${today}-${name}`)}\n`);
});

test("a description with no letters or digits is an error", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["new", "日本語"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: "sprout: '日本語' has no a-z or 0-9 to make a name from\n",
	});
	expect(await readdir(harness.root)).toEqual([]);
});

test("new with no words and no terminal attached is an error", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["new"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: "sprout: new needs a description\n",
	});
	expect(await readdir(harness.root)).toEqual([]);
});

test("new creates a missing root and its parents", async () => {
	await using harness = await createHarness();
	const root = join(harness.root, "nested/deeper");

	const result = await harness.run(["new", "idea"], {
		env: { SPROUT_ROOT: root },
	});

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(root, `${today}-idea`)}\n`,
		stderr: "",
	});
});

test("a clash appends the first free -2, -3, and so on, to the heading too", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, `${today}-idea`);
	await writeFile(
		join(harness.root, `${today}-idea-2`),
		"a file clashes too\n",
	);
	await addExperiment(harness.root, `${today}-idea-4`);

	const result = await harness.run(["new", "Idea"]);

	expect(result.stdout).toBe(`${join(harness.root, `${today}-idea-3`)}\n`);
	expect(await readme(result.stdout)).toBe("# idea-3\n\nIdea\n");
});

test("the 40-character cap does not count the clash suffix", async () => {
	await using harness = await createHarness();
	const name = "a".repeat(40);
	await addExperiment(harness.root, `${today}-${name}`);

	const result = await harness.run(["new", "a".repeat(45)]);

	expect(result.stdout).toBe(`${join(harness.root, `${today}-${name}-2`)}\n`);
});

test("new commits every file it wrote as the user in git config", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["new", "idea"]);

	const git = gitIn(result.stdout.trimEnd(), harness.home);
	expect(git("log", "--format=%an <%ae>%n%s")).toBe(
		`${gitUser.name} <${gitUser.email}>\nchore: start experiment\n`,
	);
	expect(git("ls-files")).toBe("README.md\n");
	expect(git("status", "--porcelain")).toBe("");
});

test("git ignores a GIT_DIR or GIT_WORK_TREE set around sprout", async () => {
	await using harness = await createHarness();
	const elsewhere = join(harness.home, "elsewhere");

	const result = await harness.run(["new", "idea"], {
		env: { GIT_DIR: join(elsewhere, ".git"), GIT_WORK_TREE: elsewhere },
	});

	expect(result.exitCode).toBe(0);
	const git = gitIn(result.stdout.trimEnd(), harness.home);
	expect(git("log", "--format=%s")).toBe("chore: start experiment\n");
	expect(await readdir(harness.home)).not.toContain("elsewhere");
});

test("a failed step after the directory exists removes it and exits 1", async () => {
	await using harness = await createHarness();
	const hooks = join(harness.home, "hooks");
	await mkdir(hooks);
	await writeFile(
		join(hooks, "pre-commit"),
		"#!/bin/sh\necho 'hook says no' >&2\nexit 1\n",
		{ mode: 0o755 },
	);
	await appendFile(
		join(harness.home, ".gitconfig"),
		`[core]\n\thooksPath = ${hooks}\n`,
	);

	const result = await harness.run(["new", "idea"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: "sprout: git commit failed: hook says no\n",
	});
	expect(await readdir(harness.root)).toEqual([]);
});

test("a missing git command removes the directory and exits 1", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["new", "idea"], {
		env: { PATH: harness.home },
	});

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: expect.stringMatching(/^sprout: git init failed: .*\bgit\b/),
	});
	expect(await readdir(harness.root)).toEqual([]);
});

/** A function that runs git in `cwd` with the config in `home`, giving stdout. */
function gitIn(cwd: string, home: string) {
	return (...args: string[]): string => {
		const result = Bun.spawnSync(["git", ...args], {
			cwd,
			env: { PATH: process.env.PATH, HOME: home },
		});
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		return result.stdout.toString();
	};
}

async function readme(stdout: string): Promise<string> {
	return readFile(join(stdout.trimEnd(), "README.md"), "utf8");
}
