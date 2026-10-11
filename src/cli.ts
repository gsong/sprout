import { main } from "./main.ts";

process.exitCode = await main(process.argv.slice(2), {
	env: process.env,
	stdout: process.stdout,
	stderr: process.stderr,
	programs: { claude: "claude", trash: "/usr/bin/trash", docker: "docker" },
	now: () => new Date(),
});
