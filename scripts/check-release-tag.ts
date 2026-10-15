// The release workflow runs this with the pushed tag. It fails unless the tag
// is "v" plus the version in package.json, because `sprout --version` prints
// that version and must match the release it came from.
import packageJson from "../package.json" with { type: "json" };

const tag = process.argv[2];
const expected = `v${packageJson.version}`;

if (tag !== expected) {
	console.error(
		`release tag ${tag ?? "(none)"} does not match package.json version ${packageJson.version}; expected ${expected}`,
	);
	process.exit(1);
}
