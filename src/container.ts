// Copies of the claude-container kit at tag `kitTag`, kept under src/kit at the
// kit's own paths. The text imports build them into the binary.
// `bun scripts/refresh-kit.ts <tag>` replaces them with another tag's copies.

import type { ExperimentFile } from "./files.ts";
import dockerfile from "./kit/example/docker/Dockerfile" with { type: "text" };
import dockerignore from "./kit/example/docker/Dockerfile.dockerignore" with {
	type: "text",
};
import stub from "./kit/stub/cc" with { type: "text" };

/** The claude-container tag the kit files come from. */
export const kitTag = "v2.3.0";

/**
 * The files for containerized Claude Code in the experiment `directoryName`,
 * by path in the experiment. The Docker image, volume, and network take their
 * names from `<directoryName>-claude`.
 */
export function containerFiles(
	directoryName: string,
): Record<string, ExperimentFile> {
	return {
		"docker/cc": { text: stub, mode: 0o755 },
		"docker/Dockerfile": { text: dockerfile },
		"docker/Dockerfile.dockerignore": { text: dockerignore },
		"docker/kit.toml": {
			text: `project_name = "${directoryName}-claude"\n`,
		},
		"mise.toml": { text: "" },
		".gitignore": {
			text: "docker/cc.local\ndocker/compose.local.yaml\nmise.local.toml\n",
		},
	};
}
