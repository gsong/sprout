import { expect, test } from "bun:test";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const script = join(import.meta.dir, "../scripts/check-release-tag.ts");

function checkTag(tag?: string) {
	const args = tag === undefined ? [] : [tag];
	const result = Bun.spawnSync([process.execPath, script, ...args], {
		stderr: "pipe",
	});
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

test("a tag that matches the package.json version passes", () => {
	expect(checkTag(`v${packageJson.version}`)).toEqual({
		exitCode: 0,
		stdout: "",
		stderr: "",
	});
});

test.each([
	["a different version", "v99.0.0"],
	["no leading v", packageJson.version],
	["extra text", `v${packageJson.version}-rc.1`],
])("a tag with %s fails and names both versions", (_, tag) => {
	const result = checkTag(tag);

	expect(result.exitCode).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toContain(tag);
	expect(result.stderr).toContain(`v${packageJson.version}`);
});

test("a missing tag fails", () => {
	const result = checkTag();

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain(`v${packageJson.version}`);
});
