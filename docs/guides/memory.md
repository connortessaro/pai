---
title: Memory spaces
group: Guides
---

# Memory spaces

This guide covers the notes an agent keeps between sessions: where they live, which notebook an agent uses, and how search ranks them.

Notes stay on this machine. pai sends none of them anywhere, and memory commands need no API key.

## Commands

```bash
pai memory add "The deploy script needs Node 24" --tag deploy,node
echo "longer note..." | pai memory add --title "Release steps"
pai memory search deploy node            # notes with every word, best first
pai memory search deploy node --any      # notes with any of the words
pai memory list [--tag t] [--limit n]    # newest first
pai memory show <id>
pai memory rm <id>
pai memory spaces                        # every notebook and how many notes it holds
```

`search` returns 10 notes unless you pass `--limit`, and `list` returns 50. Both take `--tag` to keep only notes with that tag.

The MCP tools are `remember`, `recall`, `list_memories` and `forget`. `recall` returns at most 50 notes and `list_memories` at most 200.

## Spaces

A space is one agent's notebook. pai picks it from the first of these that is set ({@link memorySpace}):

1. `--space <name>`, or `space` in a tool call,
2. `PAI_MEMORY_SPACE`,
3. `PHANTOM_KEY_NAME`, the saved key the agent runs as,
4. `main`.

A subagent started with `PHANTOM_KEY_NAME=researcher` writes to the space `researcher`, so subagents don't read each other's notes by accident. Any agent can still pass `--space` to read another notebook. Space names follow the key name rules: letters, numbers, `-` and `_`, up to 32 characters.

`pai browser` picks its space the same way. See [Browser and sandbox](./browser-and-sandbox.md).

## Files

Each note is a Markdown file at `memory/<space>/<id>.md` in the state folder, mode 600 ({@link addMemory}). You can read, edit, grep or commit them like any other file.

```text
---
title: The deploy script needs Node 24
created: 2026-09-24T18:02:11.000Z
tags: [deploy, node]
---
The deploy script needs Node 24
```

The id is the creation time in UTC and a short form of the title, for example `20260924-180211-the-deploy-script-needs-node-24`. The title defaults to the note's first line, cut at 80 characters. When two notes would get the same id, pai adds `-2`, `-3` and so on.

pai reads a note's title, date and tags from the block between the `---` lines, so edit them there.

## How search ranks notes

pai splits the query and each note into words made of letters and digits, ignoring case ({@link searchMemory}):

- A note must contain every query word in its title or text, unless you pass `--any`.
- Each word found adds to the note's score. Words that appear in fewer notes add more.
- A word in the title counts double.
- On a tie, the newer note comes first.

Search matches whole words: `deploy` doesn't match `deployment`.
