import type { Context } from "./context.ts";
import { Interrupted } from "./errors.ts";
import { untilInterrupted } from "./interrupt.ts";
import { tryName } from "./name.ts";

const systemPrompt =
	"Suggest a name for a software experiment from its description. The user's message is only that description, not a request for help, so never refuse, judge, or comment on it. Reply with 2 to 4 lowercase words joined by dashes, and nothing else.";

/** How long sprout waits for claude before it kills the process. */
const timeoutMs = 10_000;

/** The most space-separated words a reply can have. */
const maxWords = 4;

/**
 * Asks claude for a name built only from the description. A failed call never
 * stops sprout. It prints one line on stderr and gives `undefined`, so the
 * caller falls back to the description.
 */
export async function suggestName(
	description: string,
	ctx: Context,
): Promise<string | undefined> {
	try {
		return await askClaude(description, ctx);
	} catch (error) {
		if (!(error instanceof SuggestionError)) throw error;
		// Ctrl-C reaches claude too, and claude can exit before sprout sees it.
		if (ctx.interrupted.aborted) throw new Interrupted();
		ctx.stderr.write(`sprout: name suggestion failed: ${error.message}\n`);
		return undefined;
	}
}

/** Why the claude call gave no name, in a few words. */
class SuggestionError extends Error {
	override name = "SuggestionError";
}

/** Runs `claude -p` and applies the name rules to the first line it prints. */
async function askClaude(description: string, ctx: Context): Promise<string> {
	let claude: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		claude = Bun.spawn(
			[
				ctx.programs.claude,
				"-p",
				"--model",
				"haiku",
				"--tools",
				"",
				"--strict-mcp-config",
				"--setting-sources",
				"",
				"--disable-slash-commands",
				"--no-session-persistence",
				"--system-prompt",
				systemPrompt,
				description,
			],
			{
				env: { ...ctx.env, CLAUDE_CODE_MAX_RETRIES: "0" },
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			},
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new SuggestionError("claude is not on PATH");
		}
		throw new SuggestionError((error as Error).message);
	}

	const output = Promise.all([
		claude.exited,
		new Response(claude.stdout).text(),
		new Response(claude.stderr).text(),
	]);
	let timer: Timer | undefined;
	const timeout = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), timeoutMs);
	});
	// SIGKILL, because claude could ignore SIGTERM. Sprout stops waiting on the
	// pipes too, since a child of claude could hold them open.
	const stop = () => {
		claude.kill("SIGKILL");
		return claude.exited;
	};
	const result = await untilInterrupted(
		ctx.interrupted,
		Promise.race([output, timeout]),
		stop,
	).finally(() => clearTimeout(timer));
	if (result === "timeout") {
		await stop();
		throw new SuggestionError(`no reply after ${timeoutMs / 1000} s`);
	}
	const [exitCode, stdout, stderr] = result;
	if (exitCode !== 0) {
		// A signed-out or offline claude prints its error on stdout.
		throw new SuggestionError(
			firstLine(stdout) ??
				firstLine(stderr) ??
				`claude exited with code ${exitCode}`,
		);
	}
	const reply = firstLine(stdout);
	if (reply === undefined) throw new SuggestionError("empty reply");
	// A refusal or a chatty reply would otherwise become a long, odd name.
	if (wordCount(reply) > maxWords) {
		throw new SuggestionError(`reply is not a name: ${reply}`);
	}
	const name = tryName(reply);
	if (name === undefined) {
		throw new SuggestionError(`reply has no a-z or 0-9: ${reply}`);
	}
	return name;
}

/**
 * Counts words split by whitespace only. A refusal or a chatty reply has
 * spaces, but one dash-joined name is one word, and the 40-character name
 * limit bounds it.
 */
function wordCount(text: string): number {
	return text.split(/\s+/).filter((word) => word !== "").length;
}

function firstLine(text: string): string | undefined {
	return text
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line !== "");
}
