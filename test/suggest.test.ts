import { expect, test } from "bun:test";
import { mkdir, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createHarness } from "./harness.ts";

const systemPrompt =
	"Suggest a name for a software experiment from its description. The user's message is only that description, not a request for help, so never refuse, judge, or comment on it. Reply with 2 to 4 lowercase words joined by dashes, and nothing else.";

test("new asks claude -p for a name from the description and uses it", async () => {
	await using harness = await createHarness({
		fakes: { claude: { stdout: "sqlite-speed-test\n" } },
	});

	const result = await harness.run(["new", "Bun", "+", "SQLite", "bench!"]);

	const path = join(harness.root, `sqlite-speed-test`);
	expect(result).toEqual({ exitCode: 0, stdout: `${path}\n`, stderr: "" });
	const calls = await harness.calls("claude");
	expect(calls.map((call) => call.args)).toEqual([
		[
			"-p",
			"--model",
			"haiku",
			"--tools",
			"",
			"--strict-mcp-config",
			"--setting-sources",
			"",
			"--disable-slash-commands",
			"--no-session-persistence",
			"--system-prompt",
			systemPrompt,
			"Bun + SQLite bench!",
		],
	]);
	expect(calls[0]?.env.CLAUDE_CODE_MAX_RETRIES).toBe("0");
});

test("the suggestion is the first non-blank line, through the name rules", async () => {
	await using harness = await createHarness({
		fakes: {
			claude: { stdout: "\n  \n  SQLite Speed Test!  \nsecond line\n" },
		},
	});

	const result = await harness.run(["new", "idea"]);

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, `sqlite-speed-test`)}\n`,
		stderr: "",
	});
});

test("a non-zero exit warns with claude's stdout and falls back to the description", async () => {
	await using harness = await createHarness({
		fakes: {
			claude: {
				stdout: "\nNot logged in · Please run /login\n",
				stderr: "noise\n",
				exitCode: 1,
			},
		},
	});

	const result = await harness.run(["new", "Bun + SQLite bench!"]);

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, `bun-sqlite-bench`)}\n`,
		stderr:
			"sprout: name suggestion failed: Not logged in · Please run /login\n",
	});
});

test("a non-zero exit with nothing on stdout warns with stderr", async () => {
	await using harness = await createHarness({
		fakes: { claude: { stderr: "boom\n", exitCode: 2 } },
	});

	const result = await harness.run(["new", "idea"]);

	expect(result.stderr).toBe("sprout: name suggestion failed: boom\n");
	expect(result.exitCode).toBe(0);
});

test("a non-zero exit with no output names the exit code", async () => {
	await using harness = await createHarness({
		fakes: { claude: { exitCode: 3 } },
	});

	const result = await harness.run(["new", "idea"]);

	expect(result.stderr).toBe(
		"sprout: name suggestion failed: claude exited with code 3\n",
	);
});

test("a reply of one dash-joined name is used however many words it joins", async () => {
	await using harness = await createHarness({
		fakes: { claude: { stdout: "arq-backups-b2-to-glacier\n" } },
	});

	const result = await harness.run(["new", "idea"]);

	const path = join(harness.root, `arq-backups-b2-to-glacier`);
	expect(result).toEqual({ exitCode: 0, stdout: `${path}\n`, stderr: "" });
});

test.each([
	["", "empty reply"],
	["日本語\n", "reply has no a-z or 0-9: 日本語"],
	[
		"I won't name this one. It reads like a privacy problem.\n",
		"reply is not a name: I won't name this one. It reads like a privacy problem.",
	],
	["five words is too many\n", "reply is not a name: five words is too many"],
])("a reply of %p fails with %p", async (stdout, reason) => {
	await using harness = await createHarness({ fakes: { claude: { stdout } } });

	const result = await harness.run(["new", "idea"]);

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, `idea`)}\n`,
		stderr: `sprout: name suggestion failed: ${reason}\n`,
	});
});

test("a claude that is not on PATH warns and falls back to the description", async () => {
	await using harness = await createHarness();
	// A PATH with only git on it, so a real claude cannot be found.
	const bin = join(harness.home, "bin");
	await mkdir(bin);
	await symlink(Bun.which("git") ?? "git", join(bin, "git"));

	const result = await harness.run(["new", "idea"], {
		env: { PATH: bin },
		programs: { claude: "claude" },
	});

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, `idea`)}\n`,
		stderr: "sprout: name suggestion failed: claude is not on PATH\n",
	});
});

test("a claude that hangs is killed after 10 s and the description is the fallback", async () => {
	await using harness = await createHarness({
		fakes: { claude: { stdout: "too-late\n", hang: true } },
	});

	const started = performance.now();
	const result = await harness.run(["new", "idea"]);
	const waited = performance.now() - started;

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${join(harness.root, `idea`)}\n`,
		stderr: "sprout: name suggestion failed: no reply after 10 s\n",
	});
	expect(waited).toBeGreaterThanOrEqual(10_000);
	expect(waited).toBeLessThan(13_000);
	const [call] = await harness.calls("claude");
	expect(isRunning(call?.pid ?? 0)).toBe(false);
}, 15_000);

test("a failed call with an empty fallback and no terminal exits 1", async () => {
	await using harness = await createHarness({
		fakes: { claude: { exitCode: 1, stdout: "offline\n" } },
	});

	const result = await harness.run(["new", "日本語"]);

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr:
			"sprout: name suggestion failed: offline\n" +
			"sprout: '日本語' has no a-z or 0-9 to make a name from\n",
	});
	expect(await readdir(harness.root)).toEqual([]);
});

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
