# Coding Standards

How to write sprout's code. The rules for how the CLI behaves live in its spec, not here.

## Testing

- Test behavior through the command entry point, with a temporary root through `SPROUT_ROOT`. Source: the Testing section of the Sprout v1 spec, #12. `test/harness.ts` sets this up.
- Replace only the outside programs at the boundary: `claude`, `/usr/bin/trash`, and `docker`. Tests must not touch the real Trash, real Docker objects, or a real Claude sign-in. Source: the v1 spec, #12. `test/harness.ts` fakes these programs.

## Dependencies

- Take no tool, package, or action release younger than 7 days. `mise.toml` enforces this for tools and `bunfig.toml` for packages. No tool checks actions; the comments in `.github/workflows/ci.yml` state the rule.
- Pin GitHub Actions by commit, with the version in a comment. See the comments in `.github/workflows/ci.yml`.

## Runtime

- Bun-only APIs are allowed. See `docs/adr/0001-bun-compiled-binary.md`.

## Layout

- Put public functions at the top of a file and helpers at the bottom. Source: the maintainer's convention. No tool checks it.
