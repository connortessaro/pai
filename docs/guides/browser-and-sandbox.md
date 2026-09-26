---
title: Browser and sandbox
group: Guides
---

# Browser and sandbox

This guide covers the two local tools pai sets up: a browser for agents, and a throwaway container for running commands. Neither needs an API key or sends anything to Phantom AI.

## Browser

pai drives [agent-browser](https://github.com/vercel-labs/agent-browser), a headless Chrome built for agents. pai doesn't reimplement it; it runs it with a session and a profile for the agent's space.

```bash
pai browser setup             # is agent-browser installed, and which session and profile this space uses
pai browser setup --install   # install it if missing: npm i -g agent-browser && agent-browser install
pai browser status            # another name for setup
pai browser open https://example.com
pai browser snapshot -i
pai browser click @e1
pai browser fill @e2 "text"
pai browser screenshot
```

Anything after `browser` other than `setup` and `status` goes to agent-browser as you typed it, minus pai's own `--space`. The command exits with agent-browser's exit code ({@link runBrowser}).

### One session per space

pai sets two variables for agent-browser ({@link browserEnv}):

| Variable | pai's default | Set it yourself to |
| --- | --- | --- |
| `AGENT_BROWSER_SESSION` | `pai-<space>` | use another session name |
| `AGENT_BROWSER_PROFILE` | `browser/<space>` in the state folder | use another profile folder, or a profile name such as `Default` for one of your own Chrome profiles |

Each space gets its own tabs, cookies and logins, so a subagent's logins stay its own. pai creates the profile folder, mode 700, when the value is a path; a bare name such as `Default` it leaves alone.

The space comes from `--space`, then `PAI_MEMORY_SPACE`, then `PHANTOM_KEY_NAME`, then `main`, as for memory. See [Memory spaces](./memory.md).

## Sandbox

`pai sandbox run` runs one command in a container that is removed when the command ends.

```bash
pai sandbox check                                  # is Docker or Podman running?
pai sandbox run -- npm test
pai sandbox run --image python:3.13-slim -- python -c "print(1)"
pai sandbox run --net --write --timeout 600 -- npm ci
```

pai's flags go before `--`. Everything after `--` is joined with spaces and run with `sh -c` inside the container.

### Defaults

pai builds the container command line in {@link sandboxArgs}:

| Setting | Default | Change it with |
| --- | --- | --- |
| image | `node:24-slim` | `--image <name>` |
| network | none | `--net` |
| this folder | mounted read-only at `/work`, which is the working folder | `--write` mounts it writable |
| time limit | 300 seconds | `--timeout <seconds>` |
| user | `1000:1000`, not root, with `HOME=/tmp` | |
| Linux capabilities (the extra powers root holds) | all dropped | |
| gaining privileges | blocked (`no-new-privileges`), so a program in the container can't raise its own | |
| processes | 512 at most | |
| memory | 2 GB | |
| CPUs | 2 | |

When the time runs out, pai kills the container, prints `sandbox: stopped after <n>s` on stderr, and exits 124. Otherwise the command's exit code becomes pai's ({@link runSandbox}).

pai refuses an image name that doesn't start with a letter or digit, or that holds characters outside letters, digits and `_ . - / : @` (`sandbox_image_invalid`), since a name starting with `-` would read as an engine flag. It also refuses to mount a folder whose path holds a comma or a double quote (`sandbox_dir_invalid`), because either would change how the engine reads the mount.

### Which engine

With `PAI_SANDBOX_ENGINE` set, pai uses that engine only. Otherwise it tries `docker`, then `podman`. An engine counts only when it is on your PATH and answers `info` within 15 seconds, so Docker Desktop or a Podman machine must be running ({@link sandboxEngine}). With none running, `sandbox run` stops and tells you to start one.
