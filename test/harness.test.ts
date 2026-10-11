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
	expect(await harness.calls("claude")).toEqual([["-p", "two words"]]);
});

test.each([["claude"], ["trash"], ["docker"]] as const)(
	"an unset fake %s fails instead of running the real one",
	async (name) => {
		await using harness = await createHarness();

		const result = Bun.spawnSync([harness.programs[name], "anything"]);

		expect(result.exitCode).toBe(127);
		expect(harness.programs[name]).not.toBe(name);
		expect(await harness.calls(name)).toEqual([["anything"]]);
	},
);
