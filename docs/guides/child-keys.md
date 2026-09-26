---
title: Child keys and save_as
group: Guides
---

# Child keys and save_as

This guide covers creating a child key for a subagent, keeping the key out of the agent's context, and removing it.

## What a child key is

A child key spends its parent's balance, up to a limit, until it expires. Phantom AI moves no credit when it creates one: the child draws on the parent's balance as it spends. A child can't create children of its own; Phantom AI refuses with `parent_is_child`. The child starts with a copy of the parent's route policy. It can read its route policy and its caps, and Phantom AI refuses when it tries to change them (see [Routing and plans](./routing-and-plans.md)).

These rules belong to Phantom AI. pai sends the request and prints the answer ({@link createChild}, {@link ChildResult}).

## Creating one

```bash
pai child --limit 0.50 --ttl 6 --rate 0.10 --save researcher
```

| Flag | Meaning |
| --- | --- |
| `--limit <usd>` | the most the child may spend, in dollars. `--amount` does the same |
| `--limit none` | no limit beyond the parent's balance |
| `--ttl <hours>` | lifetime in hours. Phantom AI's default is 24 |
| `--rate <usd/min>` | a per-minute spending cap on the child |
| `--save <name>` | save the key under this name and leave it out of the output |

`--limit` is required. The old `--budget` flag stops with `child no longer takes --budget. Use --limit <usd>`.

Without `--save`, the output holds the key in `api_key`. Phantom AI shows it once and stores only a hash, so a key you lose stays lost; revoke it from the parent's side.

## Keeping the key out of the agent's context

With `--save`, pai writes the key to `keys/<name>` in the state folder and prints `saved_as` and `id` in place of `api_key`. The agent that created the child never sees the key. Start the subagent as the child by name:

```bash
PHANTOM_KEY_NAME=researcher claude
```

pai checks the name before it asks for the key, so a name that is already saved stops the command before any key exists. Names use letters, numbers, `-` and `_`, start with a letter or number, and run up to 32 characters. See [Which key a command runs as](./which-key.md) for how `PHANTOM_KEY_NAME` wins over `PHANTOM_API_KEY`, and [Saved secrets](./saved-secrets.md) for where the key is stored.

Over MCP, `create_child_key` takes `save_as` for the same purpose. When you turn mail sending on (`PAI_MAIL_SEND=1`), the tool refuses to run without `save_as` and returns the error code `key_reply_refused`: a key in the reply would sit one `mail_send` away from leaving the machine. The CLI `child` command has no such check. See [Mail](./mail.md).

## Seeing them

```bash
pai children               # keys this key created: id, active, limit, spent, left, rate, expiry
pai key list --balance     # keys saved on this machine, with each one's balance
```

`children` names each child by the start of its hash ({@link listChildren}, {@link ChildrenResult}). `key list` shows the same id next to each saved name ({@link keyId}), so you can match the two lists. The MCP tools are `list_children` and `list_saved_keys`; `list_saved_keys` never returns the keys.

## Removing one

```bash
pai burn --key-name researcher
```

pai signs in as the child, revokes it, and deletes the saved copy. Over MCP, `delete_key` does the same with `key_name` or `api_key`. Revoking a parent stops every child it created.

`pai key rm <name>` only forgets the saved copy. The key keeps working until it expires or someone revokes it.
