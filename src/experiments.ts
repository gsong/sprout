import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { unlessMissing } from "./files.ts";

const datePrefix = /^(\d{4}-\d{2}-\d{2})-/;
const heading = /^#{1,6}(\s|$)/;

/** One directory directly under the root. */
export interface Experiment {
	/** The directory's full name, such as `2026-10-10-bun-sqlite-bench`. */
	dirName: string;
	/** The `YYYY-MM-DD` prefix of a dated directory. */
	date?: string;
	/** The part after the date prefix, or the whole directory name when undated. */
	name: string;
	/** The first non-blank line after the README's first heading. */
	description?: string;
}

/** Reads every experiment in the root, in list order. A missing root has none. */
export async function readExperiments(root: string): Promise<Experiment[]> {
	const entries =
		(await unlessMissing(root, (path) =>
			readdir(path, { withFileTypes: true }),
		)) ?? [];
	const experiments = await Promise.all(
		entries.map((entry) => readExperiment(root, entry)),
	);
	return experiments
		.filter((experiment) => experiment !== undefined)
		.sort(listOrder);
}

/**
 * The directory name, two spaces, and the description, or the directory name
 * alone when there is no description.
 */
export function experimentLine({ dirName, description }: Experiment): string {
	return description === undefined ? dirName : `${dirName}  ${description}`;
}

/** Whether the directory name contains the query, ignoring case. */
export function matchesQuery(experiment: Experiment, query: string): boolean {
	return experiment.dirName.toLowerCase().includes(query.toLowerCase());
}

/**
 * The index of the README's heading, its first line that is a Markdown heading,
 * or -1 when it has none.
 */
export function headingIndex(lines: string[]): number {
	return lines.findIndex((line) => heading.test(line));
}

/** The experiment at `entry`, or `undefined` when it is hidden or not a directory. */
async function readExperiment(
	root: string,
	entry: Dirent,
): Promise<Experiment | undefined> {
	const path = join(root, entry.name);
	if (entry.name.startsWith(".") || !(await isDirectory(entry, path))) {
		return undefined;
	}
	const match = datePrefix.exec(entry.name);
	return {
		dirName: entry.name,
		date: match?.[1],
		name: match ? entry.name.slice(match[0].length) : entry.name,
		description: await readDescription(path),
	};
}

/** A directory, or a symlink that leads to one. */
async function isDirectory(entry: Dirent, path: string): Promise<boolean> {
	if (entry.isDirectory()) return true;
	if (!entry.isSymbolicLink()) return false;
	return stat(path).then(
		(stats) => stats.isDirectory(),
		() => false,
	);
}

/**
 * A README that is missing or cannot be read gives no description, so one
 * broken experiment never hides the rest.
 */
async function readDescription(path: string): Promise<string | undefined> {
	const readme = await readFile(join(path, "README.md"), "utf8").catch(
		() => undefined,
	);
	if (readme === undefined) return undefined;
	const lines = readme.split("\n");
	const first = headingIndex(lines);
	if (first === -1) return undefined;
	return lines
		.slice(first + 1)
		.map((line) => line.trim())
		.find((line) => line !== "");
}

/** Dated before undated, then by directory name, descending. */
function listOrder(a: Experiment, b: Experiment): number {
	const aDated = a.date !== undefined;
	const bDated = b.date !== undefined;
	if (aDated !== bDated) return aDated ? -1 : 1;
	return compareDescending(a.dirName, b.dirName);
}

function compareDescending(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? 1 : -1;
}
