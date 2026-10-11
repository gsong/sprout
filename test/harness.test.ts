import { expect, test } from "bun:test";
import { createHarness } from "./harness.ts";

test("a fake program prints what the test set and records its arguments", async () => {
	await using harness = await createHarness({
		fakes: {
			claude: { stdout: "bun-sqlite-bench\n", stderr: "warn\n", exitCode: 3 },
		},
	});

	const result = Bun.spawnSync([harness.programs.claude, "-p", "two words"]);

	expect(result.exitCode).toBe(3);
	expect(result.stdout.toString()).toBe("bun-sqlite-bench\n");
	expect(result.stderr.toString()).toBe("warn\n");
	const [call] = await harness.calls("claude");
	expect(call?.args).toEqual(["-p", "two words"]);
	expect(call?.pid).toBeGreaterThan(0);
});

test.each([["claude"], ["trash"], ["docker"]] as const)(
	"an unset fake %s fails instead of running the real one",
	async (name) => {
		await using harness = await createHarness();

		const result = Bun.spawnSync([harness.programs[name], "anything"]);

		expect(result.exitCode).toBe(127);
		expect(harness.programs[name]).not.toBe(name);
		expect((await harness.calls(name)).map((call) => call.args)).toEqual([
			["anything"],
		]);
	},
);

test("a fake program gives the reply set for its exact arguments, or its default", async () => {
	await using harness = await createHarness({
		fakes: {
			docker: {
				stdout: "default\n",
				replies: [
					{ args: ["image", "ls"], stdout: "abc123\n" },
					{ args: ["image", "rm", "x"], stderr: "in use\n", exitCode: 1 },
				],
			},
		},
	});
	const run = (...args: string[]) => {
		const result = Bun.spawnSync([harness.programs.docker, ...args]);
		return [
			result.exitCode,
			result.stdout.toString(),
			result.stderr.toString(),
		];
	};

	expect(run("image", "ls")).toEqual([0, "abc123\n", ""]);
	expect(run("image", "rm", "x")).toEqual([1, "", "in use\n"]);
	expect(run("image")).toEqual([0, "default\n", ""]);
});
