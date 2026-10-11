import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

let dir: string;
let binary: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "sprout-build-"));
	binary = join(dir, "sprout");
	const build = Bun.spawnSync(
		[process.execPath, "build", "--compile", "src/cli.ts", "--outfile", binary],
		{
			cwd: join(import.meta.dir, ".."),
			stderr: "pipe",
		},
	);
	if (build.exitCode !== 0) throw new Error(build.stderr.toString());
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

function runBinary(args: string[]) {
	const result = Bun.spawnSync([binary, ...args], {
		cwd: dir,
		env: { PATH: "/usr/bin:/bin" },
	});
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

test("the compiled binary prints the version it was built with", () => {
	expect(runBinary(["--version"])).toEqual({
		exitCode: 0,
		stdout: `${packageJson.version}\n`,
		stderr: "",
	});
});

test("the compiled binary exits 2 on an unknown command", () => {
	const result = runBinary(["bogus"]);

	expect(result.exitCode).toBe(2);
	expect(result.stderr).toContain("unknown command 'bogus'");
});
