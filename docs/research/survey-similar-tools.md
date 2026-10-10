# Survey of similar experiment tools

Question (issue #2): which features do existing experiment and scratch-directory tools offer, and which does a lean sprout v1 need?

Scope: sprout v1 has no project templates, no promote-to-real-repo, and no cross-machine sync. This survey notes those features anyway, so we can see how common they are.

Method: I read each tool's README and, for the main ones, its source. Every claim links to its source. Source links for `tobi/try`, `try-rs`, `scratch` and `tempit` point to a fixed commit, so the line numbers stay valid. Searches ran on 2026-10-10. A negative result (no tool does X) means my searches found none. It does not prove none exists.

## Summary table

| Tool | Language | Stars | Name scheme | Gets you into the directory with | Lifecycle |
| --- | --- | --- | --- | --- | --- |
| [tobi/try](https://github.com/tobi/try) | Ruby | about 4,000 | `YYYY-MM-DD-slug` | Shell function plus `eval` | Fuzzy browse, rename, delete, graduate |
| [try-rs](https://github.com/tassiovirginio/try-rs) | Rust | about 290 | Slug, optional date prefix | Shell function plus `eval` | Fuzzy browse, delete, move |
| [try-bedazzled](https://github.com/hmk/try-bedazzled) | Go | 4 | `YYYY-MM-DD-slug` | Shell function | Fuzzy browse, rename, delete |
| [scratch (firesquid6)](https://github.com/firesquid6/scratch) | Go | 0 | Random `adjective-noun` | None | List only |
| [tempit](https://github.com/idirxv/tempit) | Python | 4 | `mktemp` prefix | Shell function (`tempc`) | List, remove, clean all |
| [scratchpad (NikiforovAll)](https://github.com/nikiforovall/scratchpad) | TypeScript (Bun) | n/a | Slug of a given name | None | List, show, remove |
| [Lars Yencken's gist](https://gist.github.com/larsyencken/9925707) | Bash | n/a | `mktemp -d` | Subshell | Deletes on exit |

[zoxide](https://github.com/ajeetdsouza/zoxide) is not an experiment tool. I include it as a reference for the directory-change problem.

## How a tool changes your shell's directory

A child process cannot change its parent shell's working directory. Every tool in this survey that enters a directory works around this in one of two ways.

### Pattern A: shell function that evaluates printed commands

The tool is a small shell function. It runs the real program, captures what the program prints to stdout, and runs that text with `eval`. The program prints `cd '/path'`, and the function applies it in the parent shell. The program draws its menu on stderr or `/dev/tty`, so the menu does not pollute the captured text.

- `tobi/try` works this way. Users add `eval "$(try init)"` to their shell rc file. The generated `try()` function runs `try exec ... 2>/dev/tty`, then runs `eval "$out"` if the exit code is 0 ([README](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/README.md), [`init_snippet`, try.rb L1366-L1415](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/try.rb#L1366-L1415)).
- The printed script is a chain of shell commands. For "select", it is `touch`, `echo`, then `cd` ([`script_cd`, try.rb L1541-L1543](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/try.rb#L1541-L1543)). The same mechanism carries `mkdir`, `git clone`, `rm -rf` and `mv` ([try.rb L1545-L1610](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/try.rb#L1545-L1610)).
- The README says the printed commands are shell-neutral. Only the wrapper function differs per shell ([README](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/README.md)). `try` ships wrappers for bash, zsh, fish and PowerShell.
- `try-rs` uses the same pattern. Its comment says the program prints the `cd` command on stdout and renders the TUI on stderr ([shell.rs](https://github.com/tassiovirginio/try-rs/blob/4a2229cd9fb1de4815f3679bcf0a49b189296e7e/src/shell.rs)). Its README confirms the reason: "try-rs needs to change your shell's current directory, it requires a small wrapper function" ([README](https://github.com/tassiovirginio/try-rs/blob/4a2229cd9fb1de4815f3679bcf0a49b189296e7e/README.md)). It offers `try-rs --setup <shell>` for bash, zsh, fish, PowerShell and Nushell.
- `tempit` uses `eval "$(tempit init bash)"` and exposes aliases such as `tempc` (create and `cd`) ([README](https://github.com/idirxv/tempit/blob/850a8ff00f47a90abec46c757958c77fc6cada26/README.md)).
- `zoxide` is a related case. Its init script defines a function that calls `builtin cd` ([bash template](https://github.com/ajeetdsouza/zoxide/blob/main/templates/bash.txt)). The binary only chooses the target. The shell function performs the move.

### Pattern B: subshell

The script starts a new interactive shell inside the directory. Exiting that shell returns you to the old directory.

- Lars Yencken's gist runs `cd "$d"` and then `zsh` inside parentheses. When you exit, it runs `rm -rf "$d"` ([gist](https://gist.github.com/larsyencken/9925707)). The directory is truly temporary here.
- This pattern needs no shell setup. The cost is that your prompt, history and environment variables belong to a nested shell. No tool in this survey that keeps experiments uses it.

### Tools that do not change directory

`scratch` (Go) and `scratchpad` do not enter the directory. `scratch pad` creates a directory and prints "Created project ..." ([commands.go](https://github.com/firesquid6/scratch/blob/c1290273277f50de8a9283782dee489a94b244ed/commands.go)). `scratchpad new` creates the folder and prints an onboarding prompt ([README](https://github.com/nikiforovall/scratchpad/blob/b293d8726d2d9077c7e6da954913921169f8df2c/README.md)).

## Tool by tool

### tobi/try (Ruby)

Source: [repo](https://github.com/tobi/try), [README](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/README.md), [try.rb](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/try.rb). This is the tool that sprout most resembles. The author archived the C rewrite and points users to the Ruby original ([try-cli README](https://github.com/tobi/try-cli/blob/1a0bc444c182aa32c10faef80c7275a93a59519a/README.md)).

- Commands:
  - `try` opens a fuzzy browser.
  - `try <query>` filters the browser, or creates a new experiment.
  - `try new <name>` creates one.
  - `try clone <url> [name]` clones a repo.
  - `try <git-url>` is shorthand for clone, including GitHub pull request URLs.
  - `try .` or `try worktree <name>` creates a git worktree.
  - `try init [path]` prints the shell function ([README](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/README.md)).
- Layout: one flat directory, `~/src/tries` by default. The `TRY_PATH` environment variable overrides it ([README](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/README.md)). There are no subdirectories and no metadata files.
- Naming: it prefixes today's date, as in `2025-08-17-redis-experiment`. A new name that collides gets `-2`, `-3` and so on. A name that ends in digits gets its number bumped for that day ([`unique_dir_name` and `resolve_unique_name_with_versioning`, try.rb L1611-L1645](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/try.rb#L1611-L1645)). The user types the name. There is no LLM involvement.
- Recency: there is no database. Selecting an experiment runs `touch` on it, and the browser sorts by modification time. The score is `3.0 / sqrt(hours_since_modified + 1)` plus a 2.0 bonus for date-prefixed names ([try.rb L212-L228](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/try.rb#L212-L228)).
- Delete: `Ctrl-D` marks entries, then the user types a confirmation. The shell script then runs `rm -rf` on each marked directory ([try.rb L1575-L1580](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/try.rb#L1575-L1580)).
- Rename: `Ctrl-R`. Graduate (promote an experiment to a real project): `Ctrl-G`. Graduating moves the directory, or runs `git worktree move`, and leaves a symlink behind ([try.rb L1582-L1598](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/try.rb#L1582-L1598)). The help text lists these keys ([try.rb L1019-L1062](https://github.com/tobi/try/blob/be566829856ca6bd22963e38a28ffb5efa24c7de/try.rb#L1019-L1062)).
- Not present: stale cleanup, archive, description or other metadata, LLM features, containers.

### try-rs (Rust)

Source: [repo](https://github.com/tassiovirginio/try-rs), [README](https://github.com/tassiovirginio/try-rs/blob/4a2229cd9fb1de4815f3679bcf0a49b189296e7e/README.md). It calls itself a Rust port of `tobi/try`.

- Commands: `try-rs` opens the TUI. `try-rs <name>` creates or jumps. `try-rs <url> [name]` clones, with a shallow clone by default. `try-rs -w <name>` creates a worktree. It also has `--setup <shell>` and `--completions <shell>`.
- Layout: `~/work/tries` by default. The user can set one or several roots in `config.toml`, and several roots show as tabs. `TRY_PATH` overrides the setting.
- Naming: the date prefix is optional and off by default (`apply_date_prefix`). The format is configurable with a chrono string.
- Lifecycle: delete with `Ctrl-D` and a popup. Move an experiment to another root with `Alt+M`. Open it in an editor with `Ctrl+E`.
- Extras: a content preview panel, themes, icons per project type, and tab completion of existing names. These are display features.
- Not present: rename, stale cleanup, metadata, LLM features.

### try-bedazzled (Go)

Source: [README](https://github.com/hmk/try-bedazzled/blob/3b7b3f3421f82593793407f3ef783fb07c9a8365/README.md). A Go rewrite with themes. It has the same core as `try`: dated directories, fuzzy select, `clone`, `worktree`, rename that keeps the date prefix, and delete. Its only unique feature is picking an icon from words in the name. I count it as another vote for the same core, not as new ideas.

### scratch by firesquid6 (Go)

Source: [README](https://github.com/firesquid6/scratch/blob/c1290273277f50de8a9283782dee489a94b244ed/README.md), [commands.go](https://github.com/firesquid6/scratch/blob/c1290273277f50de8a9283782dee489a94b244ed/commands.go), [main.go](https://github.com/firesquid6/scratch/blob/c1290273277f50de8a9283782dee489a94b244ed/main.go). The project looks abandoned: its last push was May 2024 and it has no stars.

- Commands in `main.go`: `create`, `pad`, `pads`, `projects`, `templates`, `airdrop`. The README also lists `dir`, `elevate`, `archive` and `template`, but `main.go` does not wire them up. I treat those as planned, not shipped.
- Layout: three directories from a YAML config: `~/scratch` for scratchpads, `~/source` for projects, `~/templates` for templates ([context.go](https://github.com/firesquid6/scratch/blob/c1290273277f50de8a9283782dee489a94b244ed/context.go)).
- Naming: `scratch pad` generates a random `adjective-noun` pair from built-in word lists ([commands.go](https://github.com/firesquid6/scratch/blob/c1290273277f50de8a9283782dee489a94b244ed/commands.go)). This is the only tool here that names directories for you, and it uses random words, not an LLM.
- It requires a template for every scratchpad. Sprout v1 has no templates.

### tempit (Python)

Source: [README](https://github.com/idirxv/tempit/blob/850a8ff00f47a90abec46c757958c77fc6cada26/README.md). It tracks throwaway directories under the OS temp location.

- Commands: `tempit create [prefix]`, `list`, `remove <n>`, `clean-all`, `init <shell>`. Shell aliases: `tempc` (create and `cd`), `tempg <n>` (jump by number), `templ` (list with size, age and file count), `temprm <n>`, `tempclean`.
- Metadata: a JSON file at `/tmp/tempit_dirs.json` tracks the directories.
- Relevance: it is the only tool with a bulk cleanup command, and it shows age and size when listing. Its README calls the directories "temporary" and keeps its index in `/tmp`, so it targets throwaway work. Sprout wants experiments to persist.

### scratchpad by NikiforovAll (TypeScript, Bun)

Source: [README](https://github.com/nikiforovall/scratchpad/blob/b293d8726d2d9077c7e6da954913921169f8df2c/README.md). This tool targets a different problem: storing AI agent notes. I include it because it is the only tool that records metadata per entry.

- A pad is a folder that holds a `scratchpad.json` manifest. The folder path is its identity. There is no central store.
- Commands: `new`, `add`, `ls`, `show`, `comments`, `rm`, `ui`, `export`, `import`.
- `new "<name>" --dir <parent>` requires an explicit parent directory. The README says "placement is always deliberate (no assumed location)". This is the opposite of sprout's central-root default.
- It resolves a pad by name inside a root. The root is `--dir`, then `$SCRATCH_DIR`, then the current directory.
- Metadata: each registered file carries a description, tags and a type.
- It has a Claude Code plugin and a viewer UI. Neither matters for sprout v1.

### Lars Yencken's `tempdir` gist (Bash)

Source: [gist](https://gist.github.com/larsyencken/9925707). Eleven lines: `mktemp -d`, a subshell that enters the directory and runs `zsh`, then `rm -rf` on exit. It shows Pattern B and nothing else.

## What the survey did not find

- No tool stores a description for an experiment. `scratchpad` comes closest, with per-file descriptions inside a manifest.
- No tool asks an LLM to suggest a name. My searches for AI-named experiment directories returned only generic slug generators and unrelated tools. The closest is `scratch`, which picks two random words.
- No tool sets up containers or a Claude Code environment.
- No tool offers age-based stale cleanup. `tempit` deletes everything on request, and `scratch` lists `archive` in its README but has no code for it.

These three gaps (description, LLM name, container setup) are where sprout adds value over `try`. They also mean sprout cannot copy a design for them. Later tickets must design them.

## Features that recur across tools, ranked for a lean personal v1

The ranking weighs how many tools have a feature and how much a personal daily-use CLI breaks without it. Item 1 is the most necessary.

1. **Create and enter an experiment in one command, through a shell function.** Four of the six experiment tools do it, and `zoxide` uses the same method for plain navigation. Without it, the user must copy a path by hand. This pattern is the standard answer to the "child process cannot change the parent's directory" limit.
2. **One central root directory, overridable.** `try`, `try-rs`, `try-bedazzled` and `scratch` all do this, through an environment variable or a config file. It matches sprout's stated design.
3. **Directory name = date prefix + slug, with a collision suffix.** `try` and `try-bedazzled` always use a date prefix. `try-rs` offers one as an option. Dates give a free chronological sort, and the suffix stops two experiments with the same slug from clashing. Sprout swaps the human-typed slug for an LLM suggestion.
4. **List and reopen existing experiments, newest first.** Every tool has some form of it. `try` needs no database: it uses `touch` on entry and sorts by modification time. This keeps state on the filesystem and is cheap to copy.
5. **Fuzzy search while browsing.** The three `try` family tools make it the main interface. It matters once the user has dozens of experiments. A plain list sorted by recency is enough at first.
6. **Delete an experiment, with confirmation.** `try`, `try-rs`, `try-bedazzled`, `tempit` and `scratchpad` all provide it. Experiments pile up, and users need a way to remove them. The confirm step matters because `rm -rf` is permanent.
7. **Rename.** `try` and `try-bedazzled` have it. It is useful because the first name may be wrong, which is a bigger risk when an LLM picks the name. It is cheap to add later.
8. **Per-experiment metadata (description).** Only `scratchpad` has it. It is rare in this survey, but sprout's design requires a description. Store it in a small file inside each experiment directory, so the filesystem stays the only source of truth.
9. **Git clone and worktree into a dated directory.** `try`, `try-rs` and `try-bedazzled` offer it. It is a convenience that duplicates `git clone`, and the user did not ask for it. Defer it.
10. **Display extras: themes, icons, previews, editor launch.** `try-rs` and `try-bedazzled` invest heavily here. None of it changes what the tool can do. Skip it.
11. **Move, graduate, templates, bulk and stale cleanup.** Graduate and templates are already out of scope for v1. Bulk cleanup exists only in `tempit`, and no tool cleans by age. Skip all of these.
