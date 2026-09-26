# Security policy

## Reporting a vulnerability

Report it privately through GitHub:
[open a security advisory](https://github.com/connortessaro/pai/security/advisories/new)
(the **Security** tab, then **Report a vulnerability**). Keep vulnerabilities
out of public issues, discussions and pull requests.

Include what you can of:

- the issue and what an attacker could do with it
- steps to reproduce, or a proof of concept
- the `pai` version (`npm ls -g @connortessaro/pai`), Node version and OS

Expect a reply within a week. Once a fix ships, we publish the advisory with
credit to you, unless you'd rather not be named.

## Supported versions

Security fixes go into the latest release on npm.

## Scope

This repository holds the `pai` CLI, MCP server and skill. Vulnerabilities in
the hosted Phantom AI API at `phantom.codes` are in scope too; report them the
same way.

These areas matter most:

- **Saved secrets.** `pai login`, `pai key save`, `pai child --save` and
  `pai wallet create` save API keys and Solana secret keys, and
  `pai mail setup` saves a mail password. On macOS they go in the login
  Keychain, and the file under `~/.config/phantom-key/` (or
  `PHANTOM_STATE_DIR`) holds only a pointer to the Keychain item. Elsewhere,
  or with `PAI_KEYCHAIN=0`, the file holds the secret. pai creates these
  files with mode 600 and the folders with mode 700. A secret written with
  looser permissions, written elsewhere, or printed counts as a
  vulnerability.
- **The wallet spending cap.** pai reads `PHANTOM_WALLET_MAX_USD` from the
  environment, so an agent can't raise it. A flag, tool argument, config file
  or prompt that raises or bypasses it counts as a vulnerability.
- **Payments from the agent wallet.** A wallet payment must go to the
  recipient and exact amount the Phantom AI payment request names, with its
  reference attached, and pai must not send it twice for one request.
- **Mail sending.** `PAI_MAIL_SEND`, `PAI_MAIL_MAX_PER_DAY` and
  `PAI_MAIL_SEND_TO` come from the environment. A way for an agent to send
  mail without them, past the daily cap, or to an address `PAI_MAIL_SEND_TO`
  leaves out counts as a vulnerability.
- **Keys in output.** These return a full key: `child` without `--save`, the
  `create_child_key` tool without `save_as`, `rotate` when the old key came
  from `PHANTOM_API_KEY`, and `key show`, which prints a saved key for
  `PHANTOM_API_KEY=$(pai key show <name>)`. Any other command or tool that
  returns a full key has a bug.

Out of scope: attacks that already need write access to your home directory or
environment, and prompt injection that gets an agent to run a `pai` command the
user could run themselves.
