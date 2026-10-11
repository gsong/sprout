import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Context } from "./context.ts";
import { SproutError } from "./errors.ts";
import { unlessMissing } from "./files.ts";

type Env = Context["env"];

/**
 * Finds the root's absolute path. `SPROUT_ROOT` beats the settings file, and
 * the settings file beats the default. The root may be missing, but it must
 * not exist as anything other than a directory.
 */
export async function resolveRoot(env: Env): Promise<string> {
	const { path, source } = await configuredRoot(env);
	const root = expandHome(path, env);
	if (!isAbsolute(root)) {
		throw new SproutError(`${source} must be an absolute path: ${path}`);
	}
	const stats = await unlessMissing(root, stat);
	if (stats && !stats.isDirectory()) {
		throw new SproutError(`root is not a directory: ${root}`);
	}
	return root;
}

/** The root path as written, and a label for where it came from. */
async function configuredRoot(
	env: Env,
): Promise<{ path: string; source: string }> {
	if (env.SPROUT_ROOT) return { path: env.SPROUT_ROOT, source: "SPROUT_ROOT" };
	const file = settingsPath(env);
	const settings = await readSettings(file);
	if (settings.root !== undefined) {
		return { path: settings.root, source: `${file}: root` };
	}
	return { path: "~/src/experiments", source: "the default root" };
}

/** Replaces a leading `~`, alone or before a slash, with the home path. */
function expandHome(path: string, env: Env): string {
	if (path === "~" || path.startsWith("~/")) {
		return join(home(env), path.slice(1));
	}
	return path;
}

function settingsPath(env: Env): string {
	const configHome = env.XDG_CONFIG_HOME || join(home(env), ".config");
	return join(configHome, "sprout/config.toml");
}

interface Settings {
	root?: string;
}

/** Reads the optional settings file. A missing file means no settings. */
async function readSettings(path: string): Promise<Settings> {
	const text = await unlessMissing(path, (file) => readFile(file, "utf8"));
	if (text === undefined) return {};

	let settings: Record<string, unknown>;
	try {
		settings = Bun.TOML.parse(text) as Record<string, unknown>;
	} catch (error) {
		throw new SproutError(`${path}: ${(error as Error).message}`);
	}
	for (const key of Object.keys(settings)) {
		if (key !== "root") throw new SproutError(`${path}: unknown key '${key}'`);
	}
	if (settings.root !== undefined && typeof settings.root !== "string") {
		throw new SproutError(`${path}: root must be a string`);
	}
	return settings as Settings;
}

function home(env: Env): string {
	if (!env.HOME) throw new SproutError("HOME is not set");
	return env.HOME;
}
