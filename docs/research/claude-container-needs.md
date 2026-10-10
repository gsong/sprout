# What claude-container needs in a fresh experiment

Research for issue #3. The kit is at `/Users/george/src/sahaj/ai-progress/claude-container`. Its clone sits at tag v2.3.0, the newest release.

Paths below are relative to that kit unless noted. "Line" numbers refer to the files at v2.3.0.

The sprout repo has no `CONTEXT.md` yet. This note uses "experiment" for one directory that sprout creates.

## Summary

- An experiment needs four files: `docker/cc`, `docker/Dockerfile`, `docker/Dockerfile.dockerignore`, and a `mise.toml`. The `mise.toml` can be empty. `docker/kit.toml` is optional.
- The experiment does not have to be a git repo. It does not need a commit. Without a repo, the launcher leaves a stray empty `.git/` folder.
- Each `project_name` gets its own sign-in, image tag, and volume. 20 experiments with default names mean 20 sign-ins.
- A build with an empty `mise.toml` takes about one second and adds almost no disk. The 1 GB base image is stored once.
- Experiments can share one `project_name`. The cost is that the last build wins, so tool lists must match.

## 1. Files sprout must write

### Required

| File                                | Content                                                                         | Source                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `docker/cc`                         | Copy `stub/cc` verbatim. Mark it executable (mode 755).                         | `README.md:63-66`, `stub/cc:1-5`                          |
| `docker/Dockerfile`                 | Copy `example/docker/Dockerfile`. Keep the `FROM` line, and edit nothing else.  | `README.md:67-82`, `example/docker/Dockerfile:8`          |
| `docker/Dockerfile.dockerignore`    | Copy `example/docker/Dockerfile.dockerignore` verbatim. It is five lines.       | `README.md:83-87`, `example/docker/Dockerfile.dockerignore:3-5` |
| `mise.toml` (at the experiment root) | May be empty. The Dockerfile copies it, so it must exist.                      | `example/docker/Dockerfile:37-40`                         |

The `mise.toml` is required because of this line:

```dockerfile
COPY --chown=$HOST_USER mise.toml mise.local.tom[l] /tmp/repo/
```

The bracket makes `mise.local.toml` optional. `mise.toml` has no bracket, so a missing file should fail the build. I did not test the missing-file case. I did test an empty `mise.toml`, and the build passes.

An empty `mise.toml` is fine. The base image already ships node, python, uv, ruff, and other tools. The build log showed 10 tools "already installed".

### Optional

- `docker/kit.toml`. The launcher treats a missing file as "no settings" (`kit/src/launcher/settings.py:79-84`). Every key is optional (`README.md:88`). The keys are `project_name`, `writable_siblings`, `start_commands`, `nested_clones`, and `agent_browser_port` (`settings.py:39-45`). An unknown key stops the start (`settings.py:138-139`). Sprout should write this file only to set `project_name` (see section 4).
- `.gitignore` lines. These matter only if the experiment is a git repo (`README.md:125-131`):

  ```gitignore
  docker/cc.local
  docker/compose.local.yaml
  mise.local.toml
  ```

- `docker/compose.repo.yaml`, `docker/cc.local`, `docker/compose.local.yaml`, and `mise.local.toml`. Sprout does not need to write any of them.

### Rules inside the copied files

- The `FROM` line must read `FROM ghcr.io/ai-progress-agent/claude-container:<tag>` in lower case. The stub finds the line with a regex and stops if it finds none (`stub/cc:30-34`).
- The file `docker/cc` must stay a byte-for-byte copy. `docker/cc build` and `docker/cc upgrade` overwrite it with the stub from the image when the two differ. They print "commit it" (`kit/src/launcher/main.py:135-164`).
- The build context is the experiment root. The dockerignore lets the build see only `mise.toml` and `mise.local.toml` (`Dockerfile.dockerignore:3-5`).
- The Dockerfile declares `ARG REPO`, and the launcher passes it. No `RUN` line reads it, but it still changes the cache key (see section 4).

## 2. Where sprout should get the files

| Source                                   | Gives you                              | Version match                  | Needs                       |
| ---------------------------------------- | -------------------------------------- | ------------------------------ | --------------------------- |
| Local clone                              | stub, Dockerfile, dockerignore, kit.toml | Whatever is checked out        | The clone on disk           |
| `/opt/kit/stub/cc` in the published image | stub only                              | Exact for the tag you pull     | Docker, and the image pulled |
| GitHub raw URL at a tag                  | all four files                         | Exact for the tag you name     | Network                     |
| Templates embedded in sprout             | all four files                         | Frozen at sprout's release     | Nothing at run time         |

Facts I checked:

- The image holds only the launcher and the stub. `/opt/kit` has `cc`, `cc-local.bash`, `compose.yaml`, `src`, `stub/cc`, and the uv files. It has no `example/` folder (`Dockerfile:140-145`, `.dockerignore:5-8`). So the image cannot supply the Dockerfile or the dockerignore.
- The image stub is identical to the clone's `stub/cc` at v2.3.0. The smoke test asserts the same thing (`test/smoke.sh:61-63`).
- The repo is public, and so is the image. An anonymous token pulled the manifest for `v2.3.0`. `raw.githubusercontent.com` returns 200 for `stub/cc` and `example/docker/Dockerfile` at the `v2.3.0` tag.
- The local clone is at `v2.3.0` and has no commits after it. That may change at any time. The clone can sit on an unreleased commit.

### Version coupling

The `FROM` tag picks both the image and the launcher. The stub copies `/opt/kit` out of that image into `~/.cache/claude-container/<tag>` and runs it (`stub/cc:7-14, 43-47, 63-73`).

- The stub is "the same in every repo", but it changes between releases. A stale `docker/cc` still runs. The next `docker/cc build` rewrites it to match the image (`main.py:135-164`). That leaves an uncommitted diff in the experiment.
- The kit follows semantic versioning. A change to what `kit.toml`, the stub, or the Dockerfile must contain is a major version (`README.md:1066-1068`). Sprout's templates must match the major version in the `FROM` tag.
- With `FROM ...:latest`, a new major version arrives with no warning (`README.md:172-174`). Sprout's templates could then go stale for every new experiment. Old experiments would also move on their next `build`.
- A pinned tag with a digest keeps experiments fixed (`README.md:197-220`). The digest is in each release's notes. Dependabot only helps repos that are on GitHub, which experiments may not be.
- A stub from v2.1.0 or later is needed when using `latest` (`README.md:176-179`).

## 3. Must the experiment be a git repo?

No. I ran `docker/cc shell` in three directories: one with a commit, one with `git init` and no commit, and one with no git at all. All three started a container.

### What the launcher does with git

- `main_clone(repo)` asks git for the common directory. Outside git, it returns the experiment itself (`clones.py:17-24`).
- `REPO_GIT` is the experiment's `.git`, or the main clone's `.git` from a linked worktree (`environment.py:35-48`). The launcher mounts it writable (`kit/compose.yaml:63`). It mounts `.git/hooks` and `.git/config` read-only (`compose.yaml:71-72`).
- The launcher guards git's pointer files, hook folders, and config files. It uses `git rev-parse --git-common-dir` and `git worktree list` (`gitdirs.py:30-42`).
- It writes `.git/commondir` into a real repo if missing (`gitdirs.py:86-88`). It also sets the Mac's immutable flag on `.git/config` and a few other files for the whole session (`README.md:513-531`). While a session runs, `git config`, `git push -u`, and `git remote add` fail on the Mac for that experiment.

### No commits

This works. Inside the container, `git status` shows "No commits yet on main", and `git log` says the branch has no commits. The launcher does not read any commit.

### No git repo

This starts, but with a side effect. The launcher still sets `REPO_GIT=<experiment>/.git` (`environment.py:48`). Docker creates the missing mount sources. My run left this on the Mac:

```text
.git/
  config/    (empty folder, not a file)
  hooks/     (empty folder)
```

Inside, `git status` says "not a git repository". Later `git init` on the Mac repaired it. I ran it, and it made a normal repo. A sprout that skips `git init` leaves this stray folder.

### Other git effects that matter for experiments

- **Sibling repos.** The launcher mounts each neighbor folder that is a clone with the same `origin` host and owner (`clones.py:27-66`, `README.md:329-340`). Experiments with no `origin` mount nothing (`clones.py:47-48`). If George pushes experiments to `github.com/gsong`, each experiment would mount the others read-only. This comes from the code. I did not test it.
- **Nested clones.** Say Claude clones another repo inside an experiment. The watcher moves it aside to `<name>.cc-blocked` within about 5 seconds (`README.md:741-743`). A clone that exists at start stops the launch unless `nested_clones` names it (`README.md:724-732`). Experiments that study upstream code need `nested_clones` in `docker/kit.toml`.
- **Central directory as a repo.** `project_name` defaults from the main clone's folder name (`settings.py:73-75`). Say the central directory is itself a git repo, and experiments are plain subfolders. Then `main_clone` returns the outer repo for all of them. All would share one default name. I did not test this. In that case, sprout should write `project_name` explicitly.

## 4. `project_name`: defaults, keys, cost

### Default and format

The default starts from the main clone's folder name, in lower case. Each character outside `a-z0-9_-` becomes a dash. Then `-claude` is added (`settings.py:73-75`). Example: `my-slug` becomes `my-slug-claude`. The name must match `[a-z0-9][a-z0-9_-]*` (`settings.py:48, 125-129`). `docker/cc.local` cannot change it (`README.md:52-53`).

### What it keys

| Thing                  | Name                                | Source                           |
| ---------------------- | ----------------------------------- | -------------------------------- |
| Image                  | `<project_name>:latest`             | `compose.yaml:26`                |
| Compose project        | `<project_name>`                    | `compose.yaml:15`, `compose.py:25` |
| Login volume           | `<project_name>_claude-config`      | `compose.yaml:75, 83`            |
| Network                | `<project_name>_default`            | observed in `docker network ls`  |

The volume mounts at `~/.claude` in the container. A fresh volume is 95 bytes. It had no `.credentials.json`, so every new `project_name` needs a sign-in. This matches `README.md:142-146`.

### What does not follow `project_name`

Memory and transcripts live at `~/.claude/projects/<PROJECT_KEY>` on the Mac. The key is the experiment's path with every non-alphanumeric character turned into a dash (`environment.py:28-31`). The launcher bind-mounts that Mac folder (`compose.yaml:80`) and creates it (`plan.py:77`). So memory is separate for each experiment, even when `project_name` is shared. I confirmed two experiments with one name got two separate project folders.

### Cost of 20 experiments with default names

- **Sign-ins:** 20, one per volume.
- **Images:** 20 tags, all on one 1.01 GB base layer. The base is stored once (`docker system df -v` showed "shared size 1.014 GB").
- **Repo layer size:** with an empty `mise.toml`, about 9 KB (measured layers: 9.09 kB and 3 B). Real repos on this Mac show 109 MB to 596 MB of unique layer. The size depends on the repo's own tools.
- **Build time:**
  - empty `mise.toml`: 1.3 s for the first build, and about 0.1 s per layer on a second path.
  - `go` and `shellcheck` in `mise.toml`: 6.2 s wall, and +300 MB.
  - I did not time the 109 MB to 596 MB repos. Only the tool download time grows.
  - The base image pull is a one-time cost per tag. I did not time it.
- **Cache note:** a different experiment path misses the build cache for `add-user` and `mise install`, even with an identical `mise.toml`. `ARG REPO` changes the cache key. With an empty `mise.toml` the rerun is cheap.
- **Volume growth:** fresh volumes are tiny. Volumes in daily use on this Mac are 297 MB to 318 MB. About 289 MB of one sampled volume was a `security/` folder. I do not know what writes it.
- **Networks:** `docker compose run` left one `<project_name>_default` network per experiment. They stayed after the container exited. Docker limits how many bridge networks it can create. I believe the limit is about 30 with default settings, but I did not check it.

### Sharing one `project_name`

I built two experiments with `project_name = "shared-claude"`. The first had `shellcheck` in `mise.toml`. The second had none.

What works:

- One sign-in. A marker file written in the first experiment's container was readable in the second.
- Memory stays separate (see above).

What breaks or leaks:

- **Last build wins.** The second build replaced the image under the same tag (the image ID changed). Running the first experiment afterward had no `shellcheck`, though its `mise.toml` lists it. Sharing is safe only when every experiment has the same tools, such as all empty.
- **Shared history.** The volume holds `history.jsonl`, `file-history/`, `session-env/`, `backups/`, and `.claude.json` with per-path project entries. Every experiment on that volume can read the others'.
- **Mount-point folders.** Each experiment's memory folder name appears under the shared volume's `projects/`. Only empty folders appear, not contents.
- **Concurrent sessions.** I did not test two sessions writing one volume at once. Claude Code normally handles several sessions on one config folder.
- **Name clashes.** The sprout repo's own default name is `sprout-claude`. A shared name for experiments should avoid it, for example `experiments-claude`.
- **Renames.** The default name comes from the folder name at run time. A renamed experiment gets a new image, volume, and sign-in. The old ones stay behind.

### Avoiding the sign-in without sharing

The kit's README shows how to hand a login to the container: export it in `docker/cc.local`, copy it with `compose.local.yaml`, and write it in `local_setup` (`README.md:867-949`). The kit documents this for `gws`, not for Claude. Claude Code can read a token from `CLAUDE_CODE_OAUTH_TOKEN`. I did not verify that path in the kit. Treat it as a lead, not a result.

## 5. First-run steps

On the Mac, once:

1. Install uv with `brew install uv`. Without it, `docker/cc` stops (`kit/cc:15-18`, `README.md:11-14`).
2. Run Docker Desktop. The image is arm64 only, and the mounts need Docker Desktop's `host.docker.internal` for the browser.
3. Run `gh auth login`. Without a login, `git push` and `gh` fail inside, and the launcher warns (`main.py:87-90`).

For each experiment:

1. The stub copies the kit from the image into `~/.cache/claude-container/<tag>` the first time it sees a tag. The copy is about 530 KB. It also pulls the base image if the Mac lacks it (`stub/cc:64-73`). With a `:latest` tag, the stub pulls on a missing image, on `build`, and on `upgrade` (`stub/cc:49-62`).
2. `docker/cc build` builds the repo layer. `kit/cc` also runs `uv sync` for the kit the first time (`kit/cc:22`). A comment in the launcher says a plain run builds a missing image (`main.py:82-83`). I always ran `build` first, so I did not test that.
3. The first `docker/cc` asks for a Claude sign-in inside the container (`README.md:142-146`). It is interactive and needs a browser.
4. After `mise.toml` changes, the user runs `docker/cc build` again (`README.md:139`).

Sprout can run step 2 for the user. Step 1 happens on its own. Step 3 needs the user at the terminal.

## 6. How I checked

I built and ran throwaway experiments in the scratch directory with `FROM ...:v2.3.0`. I used `XDG_CACHE_HOME` so `~/.cache` stayed untouched. I ran `docker/cc build` and `docker/cc shell` through `script` for a terminal. I then removed the images, volumes, networks, memory folders, and scratch files. I did not change anything in the kit.

Not tested:

- a missing `mise.toml`
- the first-run auto-build
- sibling mounts across experiments
- a central repo directory
- two concurrent sessions
- the network limit
- the cold base pull

## Implications for sprout

These are options. This note does not pick among them.

**Which files to write**

- Write the four required files, and `kit.toml` only when sprout needs a non-default `project_name`.
- Mark `docker/cc` executable.
- Decide whether to write `.gitignore` lines. They matter only if the experiment is a git repo.

**Where to get them**

- Embed templates in sprout, and pin `FROM` to the tag they were written for. Sprout then needs no network. Templates drift from new releases.
- Fetch the stub and the Dockerfile from the GitHub raw URL at a chosen tag. Experiments always match the tag. This needs network.
- Copy from the local clone. It is fast, but it assumes the clone exists and sits on a release.
- Use the image only for the stub. The image has no Dockerfile or dockerignore.
- Pick `latest` or a pinned tag with digest. `latest` is simpler and risks a silent major change. A pin is stable and needs manual bumps.

**Git**

- Run `git init` (and optionally a first commit) before the first `docker/cc`. That avoids the stray `.git/config` and `.git/hooks` folders.
- If sprout skips git, remove the stray `.git/` or accept it.
- If experiments may hold cloned code, add `nested_clones` to `kit.toml`, or tell the user about the `.cc-blocked` behavior.
- If experiments get a GitHub `origin` under one owner, expect read-only sibling mounts of the others.

**`project_name` and sign-in**

- Give each experiment its own name. This costs one sign-in each, and isolates images and history.
- Share one explicit name for all experiments. This costs one sign-in, and the last build wins. It fits only if every `mise.toml` is empty or identical.
- Use a few shared names, one per tool set.
- Try a token in `docker/cc.local` to skip the sign-in. This is unverified.
- Keep sprout from renaming experiment directories, because the default name follows the folder name.

**First run**

- Sprout can run `docker/cc build` after creating the files. Or it can print the command and leave the choice to the user.
- Sprout must tell the user about uv, Docker Desktop, `gh auth login`, and the first sign-in.
- Sprout could check for uv and Docker before it offers the container option.
