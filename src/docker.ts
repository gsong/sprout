import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "./context.ts";
import { Interrupted, SproutError } from "./errors.ts";
import { readExperiments } from "./experiments.ts";
import { runChecked } from "./run.ts";

/** The Docker objects claude-container makes for one `project_name`. */
export interface DockerObjects {
	image: string;
	volume: string;
	network: string;
}

/** The project names Docker Compose accepts. */
const validProjectName = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * The `project_name` in the experiment's `docker/kit.toml`. It is `undefined`
 * when the file is missing, cannot be read or parsed, or holds no
 * `project_name` that Docker Compose accepts, since Compose then made no
 * Docker objects under that name.
 */
export async function readProjectName(
	experimentPath: string,
): Promise<string | undefined> {
	try {
		const text = await readFile(
			join(experimentPath, "docker", "kit.toml"),
			"utf8",
		);
		const { project_name } = Bun.TOML.parse(text) as { project_name?: unknown };
		if (typeof project_name !== "string") return undefined;
		return validProjectName.test(project_name) ? project_name : undefined;
	} catch {
		return undefined;
	}
}

/** The image, volume, and network named after `projectName`. */
export function dockerObjects(projectName: string): DockerObjects {
	return {
		image: `${projectName}:latest`,
		volume: `${projectName}_claude-config`,
		network: `${projectName}_default`,
	};
}

/**
 * Removes the Docker objects named after `projectName`, which the experiment
 * `dirName` under `root` used, skipping missing ones. When another experiment
 * has the same `project_name`, it removes nothing and says why on stderr.
 */
export async function removeDockerObjects(
	root: string,
	dirName: string,
	projectName: string,
	ctx: Context,
): Promise<void> {
	try {
		const sharer = await findSharer(root, dirName, projectName);
		if (sharer !== undefined) {
			ctx.stderr.write(
				`sprout: skipped Docker removal: ${sharer} also has project_name "${projectName}"\n`,
			);
			return;
		}
		await removeObjects(projectName, ctx);
	} catch (error) {
		// Ctrl-C reaches docker too, and docker can exit before sprout sees it.
		if (error instanceof Interrupted || ctx.interrupted.aborted) {
			throw new Interrupted();
		}
		// Reading the other experiments fails with a SproutError.
		if (!(error instanceof DockerError || error instanceof SproutError)) {
			throw error;
		}
		ctx.stderr.write(
			`sprout: Docker removal failed: ${(error as Error).message}\n`,
		);
	}
}

/** The first experiment other than `dirName` with the same `project_name`. */
async function findSharer(
	root: string,
	dirName: string,
	projectName: string,
): Promise<string | undefined> {
	for (const experiment of await readExperiments(root)) {
		if (experiment.dirName === dirName) continue;
		const other = await readProjectName(join(root, experiment.dirName));
		if (other === projectName) return experiment.dirName;
	}
	return undefined;
}

async function removeObjects(projectName: string, ctx: Context): Promise<void> {
	const docker = (...args: string[]) =>
		runChecked(
			[ctx.programs.docker, ...args],
			ctx,
			(reason) => new DockerError(reason),
		);
	const { image, volume, network } = dockerObjects(projectName);
	const objects = [
		{
			kind: "image",
			name: image,
			list: ["image", "ls", "--quiet", image],
			present: (out: string) => out.trim() !== "",
		},
		{
			kind: "volume",
			name: volume,
			list: ["volume", "ls", "--quiet", "--filter", `name=${volume}`],
			present: (out: string) => hasLine(out, volume),
		},
		{
			kind: "network",
			name: network,
			list: [
				"network",
				"ls",
				"--format",
				"{{.Name}}",
				"--filter",
				`name=${network}`,
			],
			present: (out: string) => hasLine(out, network),
		},
	];
	const present = [];
	for (const object of objects) {
		if (object.present(await docker(...object.list))) present.push(object);
	}
	for (const object of present) {
		await docker(object.kind, "rm", object.name);
	}
}

/** Why Docker removal failed, in a few words. */
class DockerError extends Error {
	override name = "DockerError";
}

function hasLine(text: string, line: string): boolean {
	return text.split("\n").some((each) => each.trim() === line);
}
