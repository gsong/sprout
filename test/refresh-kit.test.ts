import { expect, test } from "bun:test";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kitTag } from "../src/container.ts";

const repo = join(import.meta.dir, "..");
const api = "/repos/AI-Progress-Agent/claude-container";

/** A tag newer than any real claude-container release. */
const newTag = "v99.0.0";

/** The kit files at claude-container `kitTag`, as sprout holds them. */
const pinnedFiles = {
	"stub/cc": await readFile(join(repo, "src/kit/stub/cc"), "utf8"),
	"example/docker/Dockerfile": await readFile(
		join(repo, "src/kit/example/docker/Dockerfile"),
		"utf8",
	),
	"example/docker/Dockerfile.dockerignore": await readFile(
		join(repo, "src/kit/example/docker/Dockerfile.dockerignore"),
		"utf8",
	),
};

test("--check passes when the newest release has the pinned files", async () => {
	await using upstream = fakeUpstream({
		[kitTag]: pinnedFiles,
		[newTag]: pinnedFiles,
	});
	await using copy = await repoCopy();

	const result = await copy.run(["--check"], upstream.url);

	expect(result).toEqual({
		exitCode: 0,
		stdout: `claude-container ${newTag} has the kit files of ${kitTag}\n`,
		stderr: "",
	});
});

test("--check fails when the newest release changes a kit file", async () => {
	await using upstream = fakeUpstream({
		[kitTag]: pinnedFiles,
		[newTag]: { ...pinnedFiles, "stub/cc": "#!/bin/sh\necho new\n" },
	});
	await using copy = await repoCopy();

	const result = await copy.run(["--check"], upstream.url);

	expect(result).toEqual({
		exitCode: 1,
		stdout: `claude-container ${newTag} changes docker/cc since ${kitTag}\n`,
		stderr: "",
	});
});

test("a tag refreshes the kit files and every pin of the tag", async () => {
	const newFiles = {
		...pinnedFiles,
		"stub/cc": "#!/bin/sh\necho new\n",
		"example/docker/Dockerfile": "FROM scratch\n",
	};
	await using upstream = fakeUpstream({
		[kitTag]: pinnedFiles,
		[newTag]: newFiles,
	});
	await using copy = await repoCopy();

	const result = await copy.run([newTag], upstream.url);

	expect(result).toEqual({
		exitCode: 0,
		stdout: `refreshed the kit to claude-container ${newTag}\n`,
		stderr: "",
	});
	for (const [path, text] of Object.entries(newFiles)) {
		expect(await copy.read(`src/kit/${path}`)).toBe(text);
	}
	expect(await copy.read("src/container.ts")).toContain(
		`\nexport const kitTag = "${newTag}";\n`,
	);
	expect(await copy.read("README.md")).toContain(
		`copies of the claude-container kit at ${newTag}, built into sprout.`,
	);
	expect(await copy.read("test/container.test.ts")).toContain(
		`\t"docker/cc": "${blobId(newFiles["stub/cc"])}",\n`,
	);
	expect(await copy.run(["--check"], upstream.url)).toEqual({
		exitCode: 0,
		stdout: `claude-container ${newTag} has the kit files of ${newTag}\n`,
		stderr: "",
	});
});

test("a download that differs from its blob id changes nothing", async () => {
	const newFiles = { ...pinnedFiles, "stub/cc": "#!/bin/sh\necho new\n" };
	await using upstream = fakeUpstream(
		{ [kitTag]: pinnedFiles, [newTag]: newFiles },
		{ tampered: "example/docker/Dockerfile" },
	);
	await using copy = await repoCopy();
	const before = await copy.snapshot();

	const result = await copy.run([newTag], upstream.url);

	expect(result.exitCode).toBe(2);
	expect(result.stderr).toContain("does not match its blob id");
	expect(await copy.snapshot()).toEqual(before);
});

/**
 * A fake of the GitHub API and raw file host for claude-container. `releases`
 * maps each tag to its kit files, by upstream path; the last tag is the newest
 * release. The raw host serves the upstream path `tampered`, if given, with a
 * byte appended.
 */
function fakeUpstream(
	releases: Record<string, Record<string, string>>,
	{ tampered }: { tampered?: string } = {},
) {
	const tags = Object.keys(releases);
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === `${api}/releases/latest`) {
				return Response.json({ tag_name: tags.at(-1) });
			}
			if (url.pathname.startsWith(`${api}/contents/`)) {
				const path = url.pathname.slice(`${api}/contents/`.length);
				const tag = url.searchParams.get("ref") ?? "";
				const text = releases[tag]?.[path];
				if (text === undefined) return new Response(null, { status: 404 });
				return Response.json({
					sha: blobId(text),
					download_url: new URL(`/raw/${tag}/${path}`, url).href,
				});
			}
			const [, raw, tag = "", ...rest] = url.pathname.split("/");
			const path = rest.join("/");
			const text = releases[tag]?.[path];
			if (raw !== "raw" || text === undefined) {
				return new Response(null, { status: 404 });
			}
			return new Response(path === tampered ? `${text}#` : text);
		},
	});
	return {
		url: server.url.href,
		[Symbol.asyncDispose]: () => server.stop(true),
	};
}

/**
 * A temporary copy of the files the refresh script reads and writes, pinned to
 * `kitTag` as the real repo is.
 */
async function repoCopy() {
	const root = await mkdtemp(join(tmpdir(), "sprout-refresh-kit-"));
	for (const path of [
		"README.md",
		"src/container.ts",
		"src/kit",
		"test/container.test.ts",
	]) {
		await cp(join(repo, path), join(root, path), { recursive: true });
	}
	return {
		read: (path: string) => readFile(join(root, path), "utf8"),
		/** Every file in the copy, by path. */
		async snapshot() {
			const files: Record<string, string> = {};
			const entries = await readdir(root, {
				recursive: true,
				withFileTypes: true,
			});
			for (const entry of entries.filter((entry) => entry.isFile())) {
				const path = join(entry.parentPath, entry.name);
				files[path] = await readFile(path, "utf8");
			}
			return files;
		},
		async run(args: string[], apiUrl: string) {
			const child = Bun.spawn(
				["bun", join(repo, "scripts/refresh-kit.ts"), ...args],
				{
					cwd: root,
					env: { ...process.env, SPROUT_KIT_API: apiUrl },
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			return { exitCode, stdout, stderr };
		},
		[Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
	};
}

/** The id git gives `text` as a blob, as `git hash-object` prints it. */
function blobId(text: string): string {
	const bytes = new TextEncoder().encode(text);
	return new Bun.CryptoHasher("sha1")
		.update(`blob ${bytes.length}\0`)
		.update(bytes)
		.digest("hex");
}
