import { SproutError } from "./errors.ts";

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
		const { code, message } = error as NodeJS.ErrnoException;
		if (code === "ENOENT") return undefined;
		// Drop the trailing ", <syscall> '<path>'" so the path shows once.
		throw new SproutError(`${path}: ${message.split(", ")[0]}`);
	}
}
