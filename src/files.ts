import { SproutError } from "./errors.ts";

/** A file `new` writes, with its mode when it must be executable. */
export interface ExperimentFile {
	text: string;
	mode?: number;
}

/** Runs a file operation on `path`. A failure stops sprout and names the path. */
export async function fileOperation<T>(
	path: string,
	operation: (path: string) => Promise<T>,
): Promise<T> {
	try {
		return await operation(path);
	} catch (error) {
		throw pathError(path, error);
	}
}

/**
 * Runs a file operation on `path`. A missing path gives `undefined`. Any other
 * failure stops sprout with an error that names the path.
 */
export async function unlessMissing<T>(
	path: string,
	operation: (path: string) => Promise<T>,
): Promise<T | undefined> {
	try {
		return await operation(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw pathError(path, error);
	}
}

function pathError(path: string, error: unknown): SproutError {
	// Drop the trailing ", <syscall> '<path>'" so the path shows once.
	return new SproutError(`${path}: ${(error as Error).message.split(", ")[0]}`);
}
