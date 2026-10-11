import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addExperiment, createHarness } from "./harness.ts";

/** Writes `text` to `<configHome>/sprout/config.toml` and returns its path. */
async function writeSettings(configHome: string, text: string) {
	await mkdir(join(configHome, "sprout"), { recursive: true });
	const path = join(configHome, "sprout/config.toml");
	await writeFile(path, text);
	return path;
}

test.each([
	["unset", undefined],
	["empty", ""],
])(
	"with SPROUT_ROOT %s and no settings file, the root is ~/src/experiments",
	async (_, sproutRoot) => {
		await using harness = await createHarness();
		await addExperiment(
			join(harness.home, "src/experiments"),
			"2026-10-10-idea",
		);

		const result = await harness.run(["list"], {
			env: { SPROUT_ROOT: sproutRoot },
		});

		expect(result).toEqual({
			exitCode: 0,
			stdout: "2026-10-10-idea\n",
			stderr: "",
		});
	},
);

test("the settings file's root beats the default", async () => {
	await using harness = await createHarness();
	const root = join(harness.home, "elsewhere");
	await addExperiment(root, "2026-10-10-from-settings");
	await writeSettings(join(harness.home, ".config"), `root = "${root}"\n`);

	const result = await harness.run(["list"], {
		env: { SPROUT_ROOT: undefined },
	});

	expect(result.stdout).toBe("2026-10-10-from-settings\n");
});

test("SPROUT_ROOT beats the settings file", async () => {
	await using harness = await createHarness();
	await addExperiment(harness.root, "2026-10-10-from-env");
	await writeSettings(
		join(harness.home, ".config"),
		`root = "${join(harness.home, "elsewhere")}"\n`,
	);

	const result = await harness.run(["list"]);

	expect(result.stdout).toBe("2026-10-10-from-env\n");
});

test.each([
	["set", "xdg", "xdg"],
	["unset", undefined, ".config"],
	["empty", "", ".config"],
])(
	"with XDG_CONFIG_HOME %s, sprout reads <it or ~/.config>/sprout/config.toml",
	async (_, xdgDir, settingsDir) => {
		await using harness = await createHarness();
		const root = join(harness.home, "elsewhere");
		await addExperiment(root, "2026-10-10-from-settings");
		await writeSettings(join(harness.home, settingsDir), `root = "${root}"\n`);
		const xdgConfigHome = xdgDir ? join(harness.home, xdgDir) : xdgDir;

		const result = await harness.run(["list"], {
			env: { SPROUT_ROOT: undefined, XDG_CONFIG_HOME: xdgConfigHome },
		});

		expect(result.stdout).toBe("2026-10-10-from-settings\n");
	},
);

test.each([
	["TOML that does not parse", "root = \n", "TOML Parse error"],
	["an unknown key", 'root = "/tmp"\ncolour = "red"\n', "unknown key 'colour'"],
	["a root that is not a string", "root = 3\n", "root must be a string"],
])(
	"a settings file with %s is an error that names the file",
	async (_, text, reason) => {
		await using harness = await createHarness();
		const path = await writeSettings(join(harness.home, ".config"), text);

		const result = await harness.run(["list"], {
			env: { SPROUT_ROOT: undefined },
		});

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toStartWith(`sprout: ${path}: `);
		expect(result.stderr).toContain(reason);
	},
);

test.each([
	["SPROUT_ROOT", { SPROUT_ROOT: "~/elsewhere" }, undefined],
	["the settings file", { SPROUT_ROOT: undefined }, 'root = "~/elsewhere"\n'],
])("sprout expands a leading ~ in a root from %s", async (_, env, settings) => {
	await using harness = await createHarness();
	await addExperiment(join(harness.home, "elsewhere"), "2026-10-10-idea");
	if (settings) await writeSettings(join(harness.home, ".config"), settings);

	const result = await harness.run(["list"], { env });

	expect(result.stdout).toBe("2026-10-10-idea\n");
});

test.each([["experiments"], ["~bob/experiments"]])(
	"a relative SPROUT_ROOT (%s) is an error",
	async (sproutRoot) => {
		await using harness = await createHarness();

		const result = await harness.run(["list"], {
			env: { SPROUT_ROOT: sproutRoot },
		});

		expect(result).toEqual({
			exitCode: 1,
			stdout: "",
			stderr: `sprout: SPROUT_ROOT must be an absolute path: ${sproutRoot}\n`,
		});
	},
);

test("a relative root from the settings file is an error that names the file", async () => {
	await using harness = await createHarness();
	const path = await writeSettings(
		join(harness.home, ".config"),
		'root = "experiments"\n',
	);

	const result = await harness.run(["list"], {
		env: { SPROUT_ROOT: undefined },
	});

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: `sprout: ${path}: root must be an absolute path: experiments\n`,
	});
});

test("a root that is a regular file is an error", async () => {
	await using harness = await createHarness();
	const file = join(harness.home, "experiments.txt");
	await writeFile(file, "not a directory\n");

	const result = await harness.run(["list"], { env: { SPROUT_ROOT: file } });

	expect(result).toEqual({
		exitCode: 1,
		stdout: "",
		stderr: `sprout: root is not a directory: ${file}\n`,
	});
});

test("a settings file that cannot be read is an error that names the file", async () => {
	await using harness = await createHarness();
	const path = join(harness.home, ".config/sprout/config.toml");
	await mkdir(path, { recursive: true });

	const result = await harness.run(["list"], {
		env: { SPROUT_ROOT: undefined },
	});

	expect(result.exitCode).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toStartWith(`sprout: ${path}: `);
});
