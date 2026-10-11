/** The outside programs sprout runs. Tests replace each one with a fake. */
export const programNames = ["claude", "trash", "docker"] as const;
export type ProgramName = (typeof programNames)[number];

export interface Output {
	write(text: string): void;
}

/** Everything sprout reads from or writes to the world outside its code. */
export interface Context {
	env: Record<string, string | undefined>;
	stdout: Output;
	stderr: Output;
	/** The command or path sprout runs for each outside program. */
	programs: Record<ProgramName, string>;
}
