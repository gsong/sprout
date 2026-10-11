/** A failure sprout explains in one line on stderr. Sprout exits 1. */
export class SproutError extends Error {
	override name = "SproutError";
}

/** A wrong command or argument. Sprout exits 2 and points at --help. */
export class UsageError extends Error {
	override name = "UsageError";
}

/** The user pressed Ctrl-C. Sprout exits 130. */
export class Interrupted extends Error {
	override name = "Interrupted";
}
