---
title: Saved secrets and the macOS Keychain
group: Guides
---

# Saved secrets and the macOS Keychain

This guide covers where pai keeps keys, wallets and the mail login, how it uses the macOS Keychain, and how to back up a wallet.

## The state folder

pai keeps its files in `~/.config/phantom-key`, or in the folder `PHANTOM_STATE_DIR` names. The folder keeps the name the CLI first shipped under, so keys and wallets saved by older versions still load.

Four kinds of file hold a secret:

| File | Holds | Written by |
| --- | --- | --- |
| `key` | your login key | `pai login`, `pai rotate` |
| `keys/<name>` | a key saved by name | `pai key save`, `pai child --save`, `create_child_key` with `save_as` |
| `wallets/<name>.json` | a wallet's secret key | `pai wallet create` |
| `mail.json` | the mail login, password included | `pai mail setup` |

The rest of the folder holds no secret: `wallets/.default` (the default wallet's name), `wallet-spent.log` and `mail-sent.log` (the spending and sending caps), `pending-<id>.json` (a wallet payment waiting for credit), the lock files, `memory/` and `browser/`.

pai writes every secret file with mode 600, so only your user can read it, and sets mode 600 again when it rewrites one that already exists. It creates new folders with mode 700.

## On macOS: the Keychain

On macOS, pai puts each secret in your login Keychain and leaves a pointer in the file:

```text
pai-keychain:3f9c0a1b2c3d4e5f60718293
```

The Keychain item has the service name `pai`, the account set to the id after the colon, and a label such as `pai keys/researcher`. pai stores the value base64-encoded, and sends it to `/usr/bin/security` on standard input, so the secret never shows in the process list ({@link keychain}).

Files keep existing because listing saved keys and checking whether a wallet exists then work the same on every system.

### What the Keychain protects

The Keychain keeps secrets out of files, backups and sync folders. It doesn't keep them away from programs on your machine. pai writes items through `/usr/bin/security`, and the Keychain lets that same program read them back without a prompt. Any program running as your user can run it too.

### Moving old files in

A secret file written before pai used the Keychain still holds the secret. The first time pai reads such a file with the Keychain on, it saves the secret to the Keychain, reads it back, and replaces the file with a pointer only if the Keychain returned the same text. If the Keychain returns something else, pai deletes the new item. If it refuses the save, pai changes nothing. In both cases the file keeps the secret and the command goes on.

### A locked Keychain

Over SSH the login Keychain is often locked. Then pai can't save or read, and stops with the error code `keychain_failed`. Unlock it and run the command again:

```bash
security unlock-keychain
```

Or save to files instead with `PAI_KEYCHAIN=0`.

## Choosing files or the Keychain

| `PAI_KEYCHAIN` | macOS | Other systems |
| --- | --- | --- |
| unset | Keychain | files |
| `0` | files | files |
| `1` | Keychain | Keychain (fails with `keychain_failed`, since `/usr/bin/security` exists only on macOS) |

The setting decides where pai writes. A file that already holds a pointer is read from the Keychain whatever the setting, so turning on `PAI_KEYCHAIN=0` later leaves existing secrets in the Keychain.

`pai key rm`, `pai logout` and `pai burn` delete the Keychain item along with the file.

The tests set `PAI_KEYCHAIN=0` in `vitest.config.mts`, so they never touch your real Keychain.

## Backing up a wallet

A wallet's secret key is the only way to reach the coins in it. On macOS, `wallets/main.json` holds a pointer, so copying the file backs up nothing. Export the key itself:

```bash
security find-generic-password -s pai -w \
  -a "$(cut -d: -f2 ~/.config/phantom-key/wallets/main.json)" | base64 -d > main-backup.json
```

The result is the JSON array of bytes that `solana-keygen` writes, and pai reads it back through `PHANTOM_WALLET_FILE`. With `PAI_KEYCHAIN=0`, or on other systems, `wallets/main.json` holds the key, and a copy of the file is the backup.

To keep a wallet's secret out of the state folder, pass it at run time in `PHANTOM_WALLET_KEY` instead. See [Agent wallets and spending caps](./agent-wallet.md).
