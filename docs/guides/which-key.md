---
title: Which key a command runs as
group: Guides
---

# Which key a command runs as

This guide covers how pai picks the Phantom AI key a command spends, which commands need no key, and what `rotate` and `burn` do to a saved copy.

## The order

pai looks in three places and takes the first one it finds ({@link keySource}, {@link resolveApiKey}):

1. `PHANTOM_KEY_NAME`: the key saved under that name with `pai key save` or `pai child --save`. If no key has that name, the command stops with `No saved key named <name>`.
2. `PHANTOM_API_KEY`: the key itself, from the environment.
3. The login key: the one `pai login` saved.

With none of them, a command that needs a key stops with `No API key. Set PHANTOM_API_KEY or run: pai login`.

A saved name beats `PHANTOM_API_KEY` on purpose. When you start a subagent as a child from a shell that also exports your own key, the subagent runs as the child and spends only what the child may spend:

```bash
export PHANTOM_API_KEY=sk-phantom-...      # your key
PHANTOM_KEY_NAME=researcher claude         # this agent runs as the child "researcher"
```

`pai key show` with no name prints the key pai would use by these rules. `pai setup --agent claude --provider` relies on that: Claude Code runs `pai key show` to get its key, so a later `login` or `rotate` carries over.

## Saving keys

```bash
pai login [key]              # save your own key (prompts if you leave the key out)
pai logout                   # forget it
pai key save <name> [key]    # save another key by name
pai key list [--balance]     # saved names, with the id `pai children` shows
pai key show [name]          # print a saved key, for PHANTOM_API_KEY=$(pai key show name)
pai key rm <name>            # forget a saved key; the key keeps working
```

`login` and `key save` refuse anything that doesn't start with `sk-phantom-`, and ask Phantom AI for the key's balance before saving, so a dead key never gets saved. `key save` refuses a name that is already taken.

Names use letters, numbers, `-` and `_`, start with a letter or number, and run up to 32 characters. The id next to each name is the start of the key's SHA-256 hash ({@link keyId}), the same id `pai children` lists.

The login key lives in the file `key` in the state folder, and named keys in `keys/<name>`. On macOS those files hold a pointer to the Keychain. See [Saved secrets](./saved-secrets.md).

## Commands that need no key

These commands work on files on your machine, so pai doesn't look for a key before running them:

`wallet`, `key`, `login`, `logout`, `setup`, `memory`, `browser`, `sandbox`, `mail`, and `verify --receipt`.

`--help`, `--version` and `mcp` also start without a key.

## Rotate and burn

`pai rotate` asks Phantom AI for a new key and retires the one the command ran as ({@link rotateKey}). The old key stops working, so pai writes the new key where the old one was saved:

| The command ran as | After `rotate` |
| --- | --- |
| a named key (`PHANTOM_KEY_NAME`) | the new key replaces `keys/<name>`; the output names it in `saved_to` and leaves the key out |
| the login key | the new key replaces the login key |
| `PHANTOM_API_KEY` | nothing is saved; the output prints the new key, and you update the variable yourself |

`pai burn` revokes a key ({@link burnKey}). Phantom AI stops its child keys too, and the credit left on it is forfeited: the output shows the amount in `forfeited_usd`, and pai moves it nowhere.

```bash
pai burn                         # the key this command runs as
pai burn --key-name researcher   # a saved key, by name
```

After the key is revoked, pai deletes the saved copy it came from: `keys/<name>` for a named key, the login key for the login key. A key from `PHANTOM_API_KEY` has no saved copy to delete.

## The MCP server

`pai mcp` starts without a key and lists its tools ({@link createMcpServer}). Each tool that calls Phantom AI picks the key when you call it, by the same order as above. A missing key comes back as a tool error. The environment is the one the server started with, while the saved files are read on every call, so a `pai login` after the server starts takes effect on the next call.

These tools need no key: the memory tools, the mail tools, `list_saved_keys`, `list_wallets`, `wallet_status` and `verify_receipt`.

`delete_key` signs in as the key it deletes, which is how Phantom AI revokes a key. Pass `key_name` (a saved key, whose saved copy pai then deletes) or `api_key`. It refuses the key the server itself runs as; use `pai burn` for that one.
