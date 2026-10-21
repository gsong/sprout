// Keeps sprout's copy of the claude-container kit in step with upstream. Run it
// from the repository root.
//
//   bun scripts/refresh-kit.ts <tag>    copies the kit files at <tag> into
//                                       src/kit and points kitTag, README.md,
//                                       and kitBlobs at <tag>
//   bun scripts/refresh-kit.ts --check  exits 1 when upstream's newest release
//                                       has kit files that differ from kitBlobs
//
// Any other failure exits 2. SPROUT_KIT_API replaces https://api.github.com,
// for tests. GH_TOKEN, when set, authenticates the API calls.

const repo = "AI-Progress-Agent/claude-container";

/** The upstream path of each kit file, by its path in an experiment. */
const kitFiles: Record<string, string> = {
	"docker/cc": "stub/cc",
	"docker/Dockerfile": "example/docker/Dockerfile",
	"docker/Dockerfile.dockerignore": "example/docker/Dockerfile.dockerignore",
};

const containerPath = "src/container.ts";
const readmePath = "README.md";
const testPath = "test/container.test.ts";

// Each pattern below matches one place that pins the kit, with the pinned
// value as group 2.
const kitTagLine = /^(export const kitTag = ")([^"]+)(";)$/m;
const readmeTag =
	/(copies of the claude-container kit at )(\S+)(, built into sprout\.)/;

const command = process.argv[2];
try {
	if (command === undefined || process.argv.length > 3) {
		throw new Error("usage: bun scripts/refresh-kit.ts <tag> | --check");
	}
	process.exit(command === "--check" ? await check() : await refresh(command));
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(2);
}

/**
 * Compares the kit files in upstream's newest release against kitBlobs. A new
 * tag with the same files is not drift. Returns the exit code.
 */
async function check(): Promise<number> {
	const container = await Bun.file(containerPath).text();
	const tests = await Bun.file(testPath).text();
	const pinnedTag = readPin(container, kitTagLine, containerPath);
	const { tag_name: tag } = (await github(
		`/repos/${repo}/releases/latest`,
	)) as { tag_name: string };
	const upstream = await upstreamFiles(tag);
	const changed = Object.keys(kitFiles).filter(
		(file) => upstream[file]?.sha !== readPin(tests, blobLine(file), testPath),
	);
	if (changed.length === 0) {
		console.log(`claude-container ${tag} has the kit files of ${pinnedTag}`);
		return 0;
	}
	console.log(
		`claude-container ${tag} changes ${changed.join(", ")} since ${pinnedTag}`,
	);
	return 1;
}

/**
 * Copies the kit files at `tag` into src/kit and points kitTag, README.md, and
 * kitBlobs at `tag`. Writes nothing unless every download matches its upstream
 * blob id and every pin is found. Returns the exit code.
 */
async function refresh(tag: string): Promise<number> {
	const upstream = await upstreamFiles(tag);
	const downloads = await Promise.all(
		Object.entries(upstream).map(async ([file, { sha, download_url }]) => {
			const response = await fetch(download_url);
			if (!response.ok) {
				throw new Error(
					`GET ${download_url}: ${response.status} ${response.statusText}`,
				);
			}
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (blobId(bytes) !== sha) {
				throw new Error(`${download_url} does not match its blob id ${sha}`);
			}
			return { path: `src/kit/${kitFiles[file]}`, file, sha, bytes };
		}),
	);
	const rewrites = await Promise.all([
		repin(containerPath, [[kitTagLine, tag]]),
		repin(readmePath, [[readmeTag, tag]]),
		repin(
			testPath,
			downloads.map(({ file, sha }) => [blobLine(file), sha]),
		),
	]);

	for (const { path, bytes } of downloads) await Bun.write(path, bytes);
	for (const [path, text] of rewrites) await Bun.write(path, text);
	console.log(`refreshed the kit to claude-container ${tag}`);
	return 0;
}

interface UpstreamFile {
	sha: string;
	download_url: string;
}

/** Each kit file's blob id and download URL at `tag`, by experiment path. */
async function upstreamFiles(
	tag: string,
): Promise<Record<string, UpstreamFile>> {
	const entries = await Promise.all(
		Object.entries(kitFiles).map(async ([file, path]) => [
			file,
			(await github(
				`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(tag)}`,
			)) as UpstreamFile,
		]),
	);
	return Object.fromEntries(entries);
}

async function github(path: string): Promise<unknown> {
	const base = process.env.SPROUT_KIT_API ?? "https://api.github.com";
	const token = process.env.GH_TOKEN;
	const response = await fetch(new URL(path, base), {
		headers: {
			accept: "application/vnd.github+json",
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
	});
	if (!response.ok) {
		throw new Error(`GET ${path}: ${response.status} ${response.statusText}`);
	}
	return response.json();
}

/** The id git gives `bytes` as a blob, as `git hash-object` prints it. */
function blobId(bytes: Uint8Array): string {
	return new Bun.CryptoHasher("sha1")
		.update(`blob ${bytes.length}\0`)
		.update(bytes)
		.digest("hex");
}

/**
 * The text of `path` with the value each pattern pins replaced. Fails when a
 * pattern does not match, so a moved pin is not skipped silently.
 */
async function repin(
	path: string,
	pins: [RegExp, string][],
): Promise<[string, string]> {
	let text = await Bun.file(path).text();
	for (const [pattern, value] of pins) {
		readPin(text, pattern, path); // throws when the pin is missing
		text = text.replace(pattern, (_, before, _old, after) => {
			return `${before}${value}${after}`;
		});
	}
	return [path, text];
}

/** The value `pattern` pins in `text`, read from `path`. */
function readPin(text: string, pattern: RegExp, path: string): string {
	const value = text.match(pattern)?.[2];
	if (value === undefined)
		throw new Error(`no match for ${pattern} in ${path}`);
	return value;
}

/** Matches the line in kitBlobs for `file`. */
function blobLine(file: string): RegExp {
	return new RegExp(
		`^(\\t"${RegExp.escape(file)}": ")([0-9a-f]{40})(",)$`,
		"m",
	);
}
