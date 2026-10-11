# sprout

Sprout is a CLI that spins up discrete experiments in one central place. Trying an idea should cost a single command.

```sh
cd "$(sprout new bun sqlite bench)"
```

That command makes a dated directory under the root, such as `~/src/experiments/2026-10-10-bun-sqlite-bench`. It writes a README and starts a git repo. The `cd` then puts you inside the new directory.

## Status

Sprout is early. Two commands work today:

- `sprout new`
- `sprout list`

`sprout --help` also lists `open`, `rm`, and `rename`. Those three print `not built yet` and exit 1.

## Install

No release exists yet. The plan is a standalone binary on GitHub releases that mise installs as `github:gsong/sprout`. The first release will cover macOS on Apple silicon only. [ADR 0001](docs/adr/0001-bun-compiled-binary.md) explains why.

Until then, build it from source. You need [mise](https://mise.jdx.dev), which installs the pinned Bun version.

```sh
git clone https://github.com/gsong/sprout.git
cd sprout
mise install
bun install
bun run build
```

The build writes the binary to `dist/sprout`. Copy it to a directory on your `PATH`. The binary carries its own runtime, so it runs without Bun installed.

## Usage

### `sprout new <words...>`

`new` creates an experiment and prints its path. The words become the experiment's description:

1. Sprout asks Claude Code for a name, built only from the description. It runs `claude -p` with the Haiku model, no tools, and none of your settings, and waits at most 5 seconds.
2. Sprout makes `<root>/<YYYY-MM-DD>-<name>`, using today's local date.
3. It writes `README.md` with the name as the heading and the description below it.
4. It runs `git init` and commits the README as `chore: start experiment`. Git uses your own git config, so `git` must be on your `PATH`.

A failed Claude call never fails `new`. That covers a missing `claude` command, a signed-out or offline `claude`, and a reply after 5 seconds. Sprout prints one line on stderr, such as `sprout: name suggestion failed: claude is not on PATH`, and makes the name from the description instead.

Sprout turns Claude's reply or the description into the name by these rules, in order:

- Lowercase it, and strip accents, so `Café` becomes `cafe`.
- Replace each run of anything other than `a-z` and `0-9` with one dash.
- Trim dashes from both ends.
- Cut a name over 40 characters at the last dash that keeps it within 40.

So when Claude fails, `sprout new "Bun SQLite bench: how fast?"` makes `2026-10-10-bun-sqlite-bench-how-fast`. Run it again the same day and sprout makes `2026-10-10-bun-sqlite-bench-how-fast-2`. When Claude fails and the description has no `a-z` or `0-9` left after the rules, `new` exits with an error.

`new` prints only the path on stdout, which is what makes `cd "$(sprout new ...)"` work.

### `sprout list [filter]`

`list` prints one line per experiment: the directory name, then its description.

```console
$ sprout list
2026-10-10-cafe-uber-naive-resume-parsing  Café über naïve résumé parsing
2026-10-10-bun-sqlite-bench-how-fast-2  Bun SQLite bench: how fast?
2026-10-10-bun-sqlite-bench-how-fast  Bun SQLite bench: how fast?
```

Any directory directly under the root is an experiment, whoever created it. Sprout skips hidden directories. The description is the first non-blank line after the first heading in the experiment's `README.md`. An experiment without one shows its directory name alone.

Dated directories come first, newest first. Undated directories follow. The filter keeps experiments whose directory name contains it, ignoring case. `sprout list cafe` shows only the first line above.

## The root

The root is the one directory that holds every experiment. Sprout looks for it in this order, and the first one set wins:

1. The `SPROUT_ROOT` environment variable.
2. The `root` key in `~/.config/sprout/config.toml`, or `$XDG_CONFIG_HOME/sprout/config.toml` when that variable is set.
3. The default, `~/src/experiments`.

```toml
root = "~/experiments"
```

The path must be absolute. Sprout expands a leading `~` to your home directory. The root need not exist yet: `new` creates it. The config file accepts only the `root` key, and sprout reports any other key as an error.

## Exit codes

- `0`: the command worked.
- `1`: the command failed. Sprout prints the reason in one line on stderr.
- `2`: the command or its arguments are wrong. Sprout points at `--help`.

## Development

```sh
bun test           # run the tests
bun run check      # lint and format check with Biome
bun run format     # apply Biome's fixes
bun run typecheck  # type-check with tsc
bun run build      # compile dist/sprout
```

[`CONTEXT.md`](CONTEXT.md) defines the project's terms: experiment, root, and name. Design decisions live in [`docs/adr/`](docs/adr/).
