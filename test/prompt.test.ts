import { expect, test } from "bun:test";
import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { claudeSays, createHarness } from "./harness.ts";

const containerQuestion = "Containerized Claude Code? [y/N] ";

test("with no words, new asks for the description until it gets one", async () => {
	await using harness = await createHarness(claudeSays("bun-sqlite-bench"));

	const result = await harness.run(["new"], {
		stdin: "\n   \nBun + SQLite bench!\n\n\n",
	});

	const path = join(harness.root, `bun-sqlite-bench`);
	expect(result).toEqual({
		exitCode: 0,
		stdout: `${path}\n`,
		stderr:
			"Description: Description: Description: Name [bun-sqlite-bench]: " +
			containerQuestion,
	});
	expect(await readFile(join(path, "README.md"), "utf8")).toBe(
		"# bun-sqlite-bench\n\nBun + SQLite bench!\n",
	);
	const [call] = await harness.calls("claude");
	expect(call?.args.at(-1)).toBe("Bun + SQLite bench!");
});

test("Enter at the name prompt accepts the suggestion", async () => {
	await using harness = await createHarness(claudeSays("sqlite-speed-test"));

	const result = await harness.run(["new", "idea"], { stdin: "\n\n" });

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, `sqlite-speed-test`)}\n`,
		stderr: `Name [sqlite-speed-test]: ${containerQuestion}`,
	});
});

test("typed text replaces the suggestion and goes through the name rules", async () => {
	await using harness = await createHarness(claudeSays("sqlite-speed-test"));

	const result = await harness.run(["new", "idea"], {
		stdin: "  Café Crème!  \n\n",
	});

	expect(result.stdout).toBe(`${join(harness.root, `cafe-creme`)}\n`);
});

test("typed text with no usable characters asks again", async () => {
	await using harness = await createHarness(claudeSays("idea"));

	const result = await harness.run(["new", "idea"], {
		stdin: "日本語\nmine\n\n",
	});

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, `mine`)}\n`,
		stderr:
			"Name [idea]: " +
			"sprout: '日本語' has no a-z or 0-9 to make a name from\n" +
			"Name [idea]: " +
			containerQuestion,
	});
});

test("with no suggestion and no fallback, the prompt has no default and needs typed text", async () => {
	await using harness = await createHarness({
		fakes: { claude: { exitCode: 1, stdout: "offline\n" } },
	});

	const result = await harness.run(["new", "日本語"], { stdin: "\nmine\n\n" });

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, `mine`)}\n`,
		stderr: `sprout: name suggestion failed: offline\nName: Name: ${containerQuestion}`,
	});
});

test("the end of input at a prompt cancels with exit 1 and makes nothing", async () => {
	await using harness = await createHarness(claudeSays("idea"));

	const result = await harness.run(["new"], { stdin: "idea\n" });

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: "Description: Name [idea]: \nsprout: cancelled\n",
	});
	expect(await readdir(harness.root)).toEqual([]);
});

test("Ctrl-C at a prompt exits 130 and makes nothing", async () => {
	await using harness = await createHarness(claudeSays("idea"));
	const stdin = new PassThrough();
	stdin.write("idea\n");

	const result = await harness.run(["new"], {
		stdin,
		interruptAt: "Name [idea]: ",
	});

	expect(result).toEqual({
		exitCode: 130,
		stdout: "",
		stderr: "Description: Name [idea]: \n",
	});
	expect(await readdir(harness.root)).toEqual([]);
});

test("Ctrl-C before a prompt shows exits 130 without asking", async () => {
	await using harness = await createHarness(claudeSays("idea"));
	const ctrlC = new AbortController();
	ctrlC.abort();

	const result = await harness.run(["new"], {
		stdin: "idea\n\n",
		signal: ctrlC.signal,
	});

	expect(result).toEqual({ exitCode: 130, stdout: "", stderr: "\n" });
	expect(await readdir(harness.root)).toEqual([]);
});

test("Ctrl-C while claude runs exits 130 and stops claude", async () => {
	await using harness = await createHarness({
		fakes: { claude: { hang: true } },
	});
	const ctrlC = new AbortController();

	const running = harness.run(["new", "idea"], { signal: ctrlC.signal });
	await waitFor(async () => (await harness.calls("claude")).length > 0);
	ctrlC.abort();
	const result = await running;

	expect(result).toEqual({ exitCode: 130, stdout: "", stderr: "\n" });
	expect(await readdir(harness.root)).toEqual([]);
	const [call] = await harness.calls("claude");
	expect(isRunning(call?.pid ?? 0)).toBe(false);
});

test("Ctrl-C after the directory exists removes it and exits 130", async () => {
	await using harness = await createHarness(claudeSays("idea"));
	const hooks = join(harness.home, "hooks");
	const marker = join(harness.home, "committing");
	await mkdir(hooks);
	await writeFile(
		join(hooks, "pre-commit"),
		`#!/bin/sh\ntouch '${marker}'\nexec sleep 5\n`,
		{ mode: 0o755 },
	);
	await appendFile(
		join(harness.home, ".gitconfig"),
		`[core]\n\thooksPath = ${hooks}\n`,
	);
	const ctrlC = new AbortController();

	const running = harness.run(["new", "idea"], { signal: ctrlC.signal });
	await waitFor(() => Bun.file(marker).exists());
	ctrlC.abort();
	const result = await running;

	expect(result).toEqual({ exitCode: 130, stdout: "", stderr: "\n" });
	expect(await readdir(harness.root)).toEqual([]);
});

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
	while (!(await condition())) await Bun.sleep(10);
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
