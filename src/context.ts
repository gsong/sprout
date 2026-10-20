/** The outside programs sprout runs. Tests replace each one with a fake. */
export const programNames = ["claude", "trash", "docker"] as const;
export type ProgramName = (typeof programNames)[number];

/** Where sprout writes text. A terminal is attached when `isTTY` is true. */
export interface Output {
	write(text: string): void;
	isTTY?: boolean;
}

/** Where prompts read answers. A terminal is attached when `isTTY` is true. */
export interface Input extends NodeJS.ReadableStream {
	isTTY?: boolean;
}

/** Everything sprout reads from or writes to the world outside its code. */
export interface Context {
	env: Record<string, string | undefined>;
	stdin: Input;
	stdout: Output;
	stderr: Output;
	/** The command or path sprout runs for each outside program. */
	programs: Record<ProgramName, string>;
	/** Aborts when the user presses Ctrl-C. */
	interrupted: AbortSignal;
}
