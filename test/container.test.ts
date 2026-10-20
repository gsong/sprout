import { expect, test } from "bun:test";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addExperiment, claudeSays, createHarness, gitIn } from "./harness.ts";

const containerQuestion = "Containerized Claude Code? [y/N] ";

/** The git blob id of each kit file at claude-container v2.3.0. */
const kitBlobs = {
	"docker/cc": "25f7d19564a2500f316c1d23bcbc218fe07984da",
	"docker/Dockerfile": "106f74989fa5c7e09cfdc5c3a1e17d032c219ea1",
	"docker/Dockerfile.dockerignore": "c5d59663c6037f1b69239e80995245000e2bb67c",
};

/** Every file a containerized experiment starts with, sorted as git sorts them. */
const allFiles = [
	".gitignore",
	"README.md",
	"docker/Dockerfile",
	"docker/Dockerfile.dockerignore",
	"docker/cc",
	"docker/kit.toml",
	"mise.toml",
];

test.each(["y", "yes", "Y", "YES", "Yes"])(
	"%p at the container prompt writes the container files",
	async (answer) => {
		await using harness = await createHarness(claudeSays("idea"));

		const result = await harness.run(["new", "idea"], {
			stdin: `\n${answer}\n`,
		});

		const path = join(harness.root, `idea`);
		expect(result).toEqual({
			exitCode: 0,
			stdout: `${path}\n`,
			stderr: `Name [idea]: ${containerQuestion}`,
		});
		expect(await filesIn(path)).toEqual(allFiles);
	},
);

test.each(["", "n", "no", "yep", "y es", "sure"])(
	"%p at the container prompt writes only the README",
	async (answer) => {
		await using harness = await createHarness(claudeSays("idea"));

		const result = await harness.run(["new", "idea"], {
			stdin: `\n${answer}\n`,
		});

		expect(result).toEqual({
			exitCode: 0,
			stdout: `${join(harness.root, `idea`)}\n`,
			stderr: `Name [idea]: ${containerQuestion}`,
		});
		expect(await filesIn(result.stdout.trimEnd())).toEqual(["README.md"]);
	},
);

test("the end of input at the container prompt cancels with exit 1 and makes nothing", async () => {
	await using harness = await createHarness(claudeSays("idea"));

	const result = await harness.run(["new", "idea"], { stdin: "\n" });

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: `Name [idea]: ${containerQuestion}\nsprout: cancelled\n`,
	});
	expect(await readdir(harness.root)).toEqual([]);
});

test("with no terminal attached, new does not ask and writes only the README", async () => {
	await using harness = await createHarness(claudeSays("idea"));

	const result = await harness.run(["new", "idea"]);

	expect(result.stderr).toBe("");
	expect(await filesIn(result.stdout.trimEnd())).toEqual(["README.md"]);
});

test("the kit files match claude-container v2.3.0 byte for byte", async () => {
	await using harness = await createHarness(claudeSays("idea"));

	const result = await harness.run(["new", "idea"], { stdin: "\ny\n" });

	const path = result.stdout.trimEnd();
	const tree = gitIn(path, harness.home)("ls-tree", "-r", "HEAD");
	for (const [file, blob] of Object.entries(kitBlobs)) {
		const mode = file === "docker/cc" ? "100755" : "100644";
		expect(tree).toContain(`${mode} blob ${blob}\t${file}\n`);
	}
	expect((await stat(join(path, "docker/cc"))).mode & 0o777).toBe(0o755);
	expect(await readFile(join(path, "docker/Dockerfile"), "utf8")).toContain(
		"\nFROM ghcr.io/ai-progress-agent/claude-container:latest\n",
	);
});

test("sprout writes kit.toml, mise.toml, and .gitignore itself", async () => {
	await using harness = await createHarness(claudeSays("idea"));

	const result = await harness.run(["new", "idea"], { stdin: "\ny\n" });

	const path = result.stdout.trimEnd();
	const read = (file: string) => readFile(join(path, file), "utf8");
	expect(await read("docker/kit.toml")).toBe(`project_name = "idea-claude"\n`);
	expect(await read("mise.toml")).toBe("");
	expect(await read(".gitignore")).toBe(
		"docker/cc.local\ndocker/compose.local.yaml\nmise.local.toml\n",
	);
});

test("project_name uses the final directory name with its clash suffix", async () => {
	await using harness = await createHarness(claudeSays("idea"));
	await addExperiment(harness.root, `idea`);

	const result = await harness.run(["new", "idea"], { stdin: "\ny\n" });

	expect(
		await readFile(join(result.stdout.trimEnd(), "docker/kit.toml"), "utf8"),
	).toBe(`project_name = "idea-2-claude"\n`);
});

test("the starting commit holds all six container files", async () => {
	await using harness = await createHarness(claudeSays("idea"));

	const result = await harness.run(["new", "idea"], { stdin: "\ny\n" });

	const git = gitIn(result.stdout.trimEnd(), harness.home);
	expect(git("log", "--format=%s")).toBe("chore: start experiment\n");
	expect(git("ls-files").split("\n").filter(Boolean)).toEqual(allFiles);
	expect(git("status", "--porcelain")).toBe("");
});

test("the starting commit holds files the user's global gitignore matches", async () => {
	await using harness = await createHarness(claudeSays("idea"));
	await mkdir(join(harness.home, ".config/git"), { recursive: true });
	await writeFile(
		join(harness.home, ".config/git/ignore"),
		"mise.toml\ndocker/\n",
	);

	const result = await harness.run(["new", "idea"], { stdin: "\ny\n" });

	expect(result.exitCode).toBe(0);
	const git = gitIn(result.stdout.trimEnd(), harness.home);
	expect(git("ls-files").split("\n").filter(Boolean)).toEqual(allFiles);
});

test("on yes, sprout runs no docker command and prints no hint", async () => {
	await using harness = await createHarness(claudeSays("idea"));

	const result = await harness.run(["new", "idea"], { stdin: "\ny\n" });

	expect(result.stderr).toBe(`Name [idea]: ${containerQuestion}`);
	expect(await harness.calls("docker")).toEqual([]);
});

/** Every file under `dir` outside `.git`, as sorted paths relative to it. */
async function filesIn(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
		.filter((file) => !file.startsWith(".git/"))
		.sort();
}
