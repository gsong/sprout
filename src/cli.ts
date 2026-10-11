import { main } from "./main.ts";

// Ctrl-C lets sprout clean up before it exits, however often it is pressed.
const interrupt = new AbortController();
process.on("SIGINT", () => interrupt.abort());

process.exitCode = await main(process.argv.slice(2), {
	env: process.env,
	stdout: process.stdout,
	stderr: process.stderr,
	programs: { claude: "claude", trash: "/usr/bin/trash", docker: "docker" },
	stdin: process.stdin,
	now: () => new Date(),
	interrupted: interrupt.signal,
});
