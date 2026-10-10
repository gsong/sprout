# Ship sprout as a Bun-compiled binary, not a Node package on npm

Sprout is TypeScript that `bun build --compile` turns into a standalone binary. CI attaches the binary to a GitHub release, and mise installs it as `github:gsong/sprout`. The binary carries its own runtime, so users need neither Node nor Bun. The code may call Bun-only APIs (`Bun.spawn`, `Bun.file`, `bun test`).

## Considered Options

- **Node on npm, like ccmcp.** The obvious path, since ccmcp already has the tooling. Rejected because every user would need Node, and a binary is easier to hand to others later.
- **Bun script on npm.** Rejected because every user would need Bun installed.

## Consequences

- Moving back to Node means replacing every Bun-only API call and the `bun test` suite.
- v1 builds only macOS arm64. Each new platform needs one more `--target` in the release workflow.
- Nothing is published to npm, and the npm name `sprout` is taken anyway.
