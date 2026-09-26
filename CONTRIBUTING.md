# Contributing to pai

Bug reports, fixes and small features are welcome. For a large change, open an
issue first so we can agree on the shape before you write it.

## Setup

You need Node 24 or newer.

```bash
git clone https://github.com/connortessaro/pai.git
cd pai
npm ci
npm run dev -- --help     # run the CLI from source
```

Node strips the types from `src/pai.mts` itself, so you need no build step
while you work. `npm run build` compiles it to `dist/`, which the published
`bin.mjs` runs.

## Checks

Run these before you open a pull request. CI runs the same three on each push
and pull request to `main`.

```bash
npm run typecheck
npm test
node scripts/gen-docs.mjs --check
```

The tests replace `globalThis.fetch` with a stub and point `PHANTOM_STATE_DIR`
at a temp directory. They don't call the Phantom AI API, touch Solana, or read
your saved keys and wallets. Write new tests the same way.

`npm run coverage` prints coverage for `src/pai.mts` and fails if statements,
branches, functions or lines drop under 80% (`vitest.config.mts`).

## Layout

| Path | What it is |
| --- | --- |
| `src/pai.mts` | The whole CLI and MCP server |
| `bin.mjs` | The installed entry point. Imports `dist/pai.mjs` |
| `skills/phantom-ai/SKILL.md` | The skill `pai setup` installs for pi, Claude Code, Codex and Cursor |
| `test/pai.test.ts` | Tests (vitest) |
| `test/modules.test.ts` | Case tests for every section, command and MCP tool, with `child_process`, `imapflow` and `nodemailer` mocked |
| `scripts/gen-docs.mjs` | Writes `docs/reference.md` from the code, checks that the code, `HELP` and the docs agree, then builds the docs site. `--check` also fails if the file is out of date |
| `docs/reference.md` | Generated interface reference. Do not edit it by hand |
| `docs/guides/` | Guides to how pai behaves, written by hand, part of the docs site |
| `docs/index.md` | The docs site's home page |
| `typedoc.json` | TypeDoc settings. `npm run docs` builds the site to `docs/site/`, which git ignores |
| `.github/workflows/docs.yml` | Builds the site on each push to `main` and publishes it to GitHub Pages |
| `scripts/sync-version.mjs` | Copies the `package.json` version into `VERSION` in `src/pai.mts` during `npm version` |

## Style

- Keep the CLI in one file. Add to `src/pai.mts` instead of splitting it into
  modules. Sections start with a `// ── name ───` line; put new code in the
  section it belongs to.
- The runtime dependencies are the MCP SDK, zod, `@solana/kit`, and imapflow,
  mailparser and nodemailer for mail. HTTP goes through `fetch`. Ask before you
  add a dependency.
- Client functions are exported, take the key and an optional base URL, and
  return the API's JSON. The CLI and the MCP tools both call them.
- Commands print JSON on stdout, and `--table` renders it for people. Exit code
  2 means the key was rejected and 1 means any other error. Use `die()` for
  errors.
- Never print, log or write a key or wallet secret outside the mode 600 files
  meant to hold it.
- Write docs and help text in plain words. Describe what a command does, and
  leave out why someone should use it.

## Adding a command

1. Add the client function in the section for its area, and export it.
2. Add a branch for it in `run()`, parse flags with `parseFlags`, and print
   with `out()`. Add a table renderer if `--table` needs one.
3. Add it to `HELP`, then run `npm run docs`. If it starts a new group, add
   the group to the commands table in `README.md`.
4. Test it through `run()` with a stubbed `fetch`.

## Adding an MCP tool

1. Register it in `createMcpServer()` with `server.registerTool`, a
   `description`, a zod input schema with a `.describe()` on every field, and
   `annotations` (`readOnlyHint`, `destructiveHint`,
   `openWorldHint`) that match what it does.
2. Wrap the call in `call()`, so a missing key or an API error comes back as a
   tool error instead of a crash. Memory and mail tools need no key and use
   `local()` and `noKeyCall()` instead.
3. Update the tool count in the `pai mcp` stdio test, then run `npm run docs`.

## Adding an environment variable

Add it to `ENV_VARS` in `src/pai.mts`, with `secret`, `envOnly` or `cap` if
they apply. `HELP` and `docs/reference.md` are built from that list, and
`npm run docs` fails if the code reads a variable the list leaves out. Run
`npm run docs` after the change.

## Generated docs

`docs/reference.md` comes from the code. After you change a command, a flag, a
tool, an API call or an environment variable, run `npm run docs` and commit the
result. The script reads `src/pai.mts` with the TypeScript compiler and fails,
listing each problem, when:

- `run()` handles a command, subcommand or flag that `HELP` leaves out, or
  `HELP` names one that `run()` doesn't read
- the code reads an environment variable that `ENV_VARS` leaves out, or
  `ENV_VARS` lists one it never reads
- an MCP tool or input field has no description, or a tool has no annotations
- it can't read the method, path or headers of a call to Phantom AI
- a guide, the README, CONTRIBUTING or the skill names a `pai` command, flag or
  environment variable that doesn't exist

It then builds the site with TypeDoc, which fails on an export without a doc
comment, a `{@link}` to a name that doesn't exist, or a link to a missing file.
Write a doc comment for anything you export.

The site has the code reference, the guides in `docs/guides/` and the interface
reference. `npm run docs` builds it to `docs/site/`, which is not committed;
open `docs/site/index.html` to read it. The Docs workflow publishes it to
https://connortessaro.github.io/pai/ on every push to `main`. CI fails a pull
request whose `docs/reference.md` is out of date or whose docs disagree with the
code.

When behaviour changes, update the guide that describes it. Link code with
`{@link name}`; TypeDoc checks that the name exists.

## Changing the skill

Agents read `skills/phantom-ai/SKILL.md`. Keep each section short: a heading
that names the task, the commands, and a line or two on what they return. Put
anything an agent must never do under `## Rules`. If you add a command an agent
should use, add it here as well as to `HELP`. Keep `name: phantom-ai` in the
frontmatter; the setup test checks for it.

## Pull requests

- One change per pull request, with a test when behaviour changes.
- Add a line under `## [Unreleased]` in `CHANGELOG.md`.
- Maintainers squash-merge pull requests, so the title becomes the commit
  message. Use the form `feat: ...`, `fix: ...`, `docs: ...` or `chore: ...`.

## Security

Report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes, and
keep it out of public issues.

By contributing you agree to release your work under the
[MIT License](LICENSE) and to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Releasing

Maintainers only.

1. Move the notes under `## [Unreleased]` in `CHANGELOG.md` into a new version
   section, and merge that.
2. On an up-to-date `main`, run `npm version patch` (or `minor`, `major`). It
   updates `package.json`, syncs `VERSION` in `src/pai.mts`, commits and tags.
3. Run `git push --follow-tags`. The Release workflow checks that the tag and
   both versions match, runs the typecheck and tests, publishes to npm with
   provenance, and creates the GitHub release from the changelog.

npm can attach a trusted publisher only to a package that already exists, so
the first publish needs a one-time `NPM_TOKEN` secret or a manual
`npm publish`. Delete the secret afterwards. `release.yml` has the details.
