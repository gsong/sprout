# sprout

Sprout is a CLI that spins up discrete experiments in one central place. Trying an idea should cost a single command.

```sh
cd "$(sprout new bun sqlite bench)"
```

That command makes a dated directory under the root, such as `~/src/experiments/2026-10-10-bun-sqlite-bench`. It writes a README and starts a git repo. The `cd` then puts you inside the new directory.

## Status

Sprout is early, but all five v1 commands work:

- `sprout new`
- `sprout list`
- `sprout open`
- `sprout rm`
- `sprout rename`

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

### `sprout new [words...]`

`new` creates an experiment and prints its path. The words become the experiment's description. With no words, sprout asks `Description:`, and asks again until the answer is not blank.

1. Sprout asks Claude Code for a name, built only from the description. It runs `claude -p` with the Haiku model, no tools, and none of your settings, and waits at most 10 seconds.
2. Sprout shows the suggestion, as in `Name [bun-sqlite-bench]:`. Enter accepts it. Typed text replaces it and goes through the name rules below. When the rules leave nothing of the typed text, sprout says so and asks again.
3. Sprout asks `Containerized Claude Code? [y/N]`. `y` or `yes`, in any case, means yes. Anything else means no. [Containerized Claude Code](#containerized-claude-code) lists what yes adds.
4. Sprout makes `<root>/<YYYY-MM-DD>-<name>`, using today's local date.
5. It writes `README.md` with the name as the heading and the description below it.
6. It runs `git init` and commits every file it wrote as `chore: start experiment`. Git uses your own git config, so `git` must be on your `PATH`.

A failed Claude call never fails `new`. That covers a missing `claude` command, a signed-out or offline `claude`, a reply after 10 seconds, and a reply of more than 4 words, such as a refusal. Sprout prints one line on stderr, such as `sprout: name suggestion failed: claude is not on PATH`, and suggests a name made from the description instead.

Sprout turns Claude's reply, the description, or a typed name into the name by these rules, in order:

- Lowercase it, and strip accents, so `Café` becomes `cafe`.
- Replace each run of anything other than `a-z` and `0-9` with one dash.
- Trim dashes from both ends.
- Cut a name over 40 characters at the last dash that keeps it within 40.

So when Claude fails, `sprout new "Bun SQLite bench: how fast?"` suggests `bun-sqlite-bench-how-fast`. Accept it, and sprout makes `2026-10-10-bun-sqlite-bench-how-fast`. Run it again the same day and sprout makes `2026-10-10-bun-sqlite-bench-how-fast-2`. When Claude fails and the description has no `a-z` or `0-9` left after the rules, the prompt shows `Name:` with no suggestion, and you must type one.

`new` prints only the path on stdout, which is what makes `cd "$(sprout new ...)"` work. The prompts go to stderr, so they still show inside the `$(...)`.

#### Prompts without a terminal

Sprout asks only when stdin is a terminal. Otherwise it decides without asking:

- With no words, `new` exits with an error.
- The suggestion becomes the name. With no suggestion, `new` exits with an error.
- The answer to the container question is no.

Ctrl-D at any prompt cancels `new`: sprout prints `sprout: cancelled` and exits 1. Ctrl-C exits 130. Either way, sprout leaves no half-made experiment behind.

#### Containerized Claude Code

A yes adds six files for [claude-container](https://github.com/AI-Progress-Agent/claude-container), which runs Claude Code in Docker. They go into the starting commit with the README.

- `docker/cc`, `docker/Dockerfile`, and `docker/Dockerfile.dockerignore`: copies of the claude-container kit at v2.3.0, built into sprout.
- `docker/kit.toml`: sets `project_name` to the directory name plus `-claude`, such as `2026-10-10-bun-sqlite-bench-claude`.
- `mise.toml`: empty. The image installs the tools listed here. Run `docker/cc build` after you change it.
- `.gitignore`: ignores the kit's files for one machine only, such as `docker/cc.local`.

`project_name` names the Docker image and the volume that holds the Claude sign-in. So each containerized experiment has its own image and needs its own sign-in. `sprout rm` removes them along with the experiment.

Sprout builds nothing, and it checks for neither Docker nor uv, which `docker/cc` needs. Run `docker/cc` inside the experiment to start Claude Code in its container. The [kit's README](https://github.com/AI-Progress-Agent/claude-container#readme) covers setup.

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

### `sprout open [query]`

`open` picks one experiment and prints its absolute path on stdout, so `cd "$(sprout open bun)"` moves you into it.

The query works like the `list` filter: it matches experiments whose directory name contains it, ignoring case. When one experiment matches, sprout prints its path without asking. When none match, sprout exits with an error. With no query, every experiment matches.

When several match, sprout shows a numbered pick list on stderr, in `list` order, and asks for a number:

```console
$ sprout open bun
1) 2026-10-10-bun-sqlite-bench-how-fast-2  Bun SQLite bench: how fast?
2) 2026-10-10-bun-sqlite-bench-how-fast  Bun SQLite bench: how fast?
Number [1-2]:
```

An answer that is not a listed number asks again. An empty answer or Ctrl-D cancels: sprout prints `sprout: cancelled` and exits 1. Without a terminal, sprout cannot ask, so several matches are an error. A root that does not exist yet has no experiments to open.

### `sprout rm [query]`

`rm` picks one experiment the same way `open` does, pick list included, and moves it to the macOS Trash. Before it removes anything, it shows the experiment's path and description on stderr and asks:

```console
$ sprout rm deno
/Users/you/src/experiments/2026-10-09-deno-kv
Try Deno KV
Remove? [y/N]
```

`y` or `yes`, in any case, removes it. Anything else, an empty answer, or Ctrl-D cancels: sprout prints `sprout: cancelled` and exits 1. Without a terminal, sprout cannot ask, so `rm` exits with an error and removes nothing.

Sprout moves the directory with `/usr/bin/trash`, which macOS 15 and later ship, so you can put it back from the Trash. If `trash` fails, sprout prints its error and exits 1. `rm` prints nothing on stdout.

#### Docker objects

When the experiment uses [containerized Claude Code](#containerized-claude-code), `rm` also removes its Docker objects. If `docker/kit.toml` sets `project_name`, the confirmation adds a line that names them:

```console
$ sprout rm sqlite
/Users/you/src/experiments/2026-10-10-bun-sqlite-bench
Bench SQLite in Bun
Docker: image 2026-10-10-bun-sqlite-bench-claude:latest, volume 2026-10-10-bun-sqlite-bench-claude_claude-config, network 2026-10-10-bun-sqlite-bench-claude_default
Remove? [y/N]
```

One yes covers the directory and the Docker objects. After the directory is in the Trash, sprout removes the image `<project_name>:latest`, the volume `<project_name>_claude-config`, which holds the Claude sign-in, and the network `<project_name>_default`. It skips any that do not exist. Unlike the directory, these do not go to the Trash.

- If another experiment's `docker/kit.toml` sets the same `project_name`, sprout leaves Docker alone and says so on stderr.
- If Docker fails, sprout prints one warning on stderr and still exits 0. That covers a missing `docker` command, a stopped Docker daemon, and an image that a container still uses. Sprout stops at the first failure, so remove what is left with `docker` yourself.
- Sprout never touches the Claude Code history in `~/.claude/projects`.

### `sprout rename <query> <new name...>`

`rename` picks one experiment the same way `open` does, pick list included, and gives it a new name. The words after the query become the new name, joined with spaces and put through the [name rules](#sprout-new-words). When the rules leave nothing, sprout exits with an error. Sprout never asks Claude for a name here.

```console
$ sprout rename sqlite SQLite speed
/Users/you/src/experiments/2026-10-10-sqlite-speed
```

A dated directory keeps its date and gets the new name, so `2026-10-10-bun-sqlite-bench` becomes `2026-10-10-sqlite-speed`. An undated directory becomes the bare new name. If a directory with the new name already exists, sprout exits with an error and changes nothing. It never adds a `-2`.

Sprout changes the README heading only if it still reads exactly `# <old name>`. A heading you edited stays as it is.

`rename` leaves the rest alone. It makes no git commit, so the README change shows up in `git status`. It keeps `docker/kit.toml` as it is, so a containerized experiment keeps its image and Claude sign-in. It does not touch the Claude Code history in `~/.claude/projects`, which stays under the old path.

`rename` prints the new absolute path on stdout, so `cd "$(sprout rename bench sqlite speed)"` moves you into it.

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
- `130`: you pressed Ctrl-C. Sprout removes anything `new` had half made.

## Development

```sh
bun test           # run the tests
bun run check      # lint and format check with Biome
bun run format     # apply Biome's fixes
bun run typecheck  # type-check with tsc
bun run build      # compile dist/sprout
```

[`CONTEXT.md`](CONTEXT.md) defines the project's terms: experiment, root, and name. Design decisions live in [`docs/adr/`](docs/adr/).
