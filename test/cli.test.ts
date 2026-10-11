import { expect, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };
import { createHarness } from "./harness.ts";

test("--version prints the version from package.json", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["--version"]);

	expect(result).toEqual({
		exitCode: 0,
		stdout: `${packageJson.version}\n`,
		stderr: "",
	});
});

test("--help lists the five commands on stdout", async () => {
	await using harness = await createHarness();

	const result = await harness.run(["--help"]);

	expect(result.exitCode).toBe(0);
	expect(result.stderr).toBe("");
	for (const command of ["new", "list", "open", "rm", "rename"]) {
		expect(result.stdout).toMatch(new RegExp(`^  sprout ${command}\\b`, "m"));
	}
});

test.each([["bogus"], ["--bogus"]])(
	"unknown command %s is a usage error on stderr",
	async (command) => {
		await using harness = await createHarness();

		const result = await harness.run([command]);

		expect(result).toEqual({
			exitCode: 2,
			stdout: "",
			stderr: `sprout: unknown command '${command}'\nRun 'sprout --help' for usage.\n`,
		});
	},
);

test("no command is a usage error that shows the help on stderr", async () => {
	await using harness = await createHarness();

	const result = await harness.run([]);

	expect(result.exitCode).toBe(2);
	expect(result.stdout).toBe("");
	expect(result.stderr).toMatch(/^ {2}sprout list\b/m);
});
