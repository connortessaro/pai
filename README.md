<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/logo-light.svg">
    <img alt="Phantom Logo" src=".github/assets/logo-dark.svg" width="56" height="62">
  </picture>
</p>

<h1 align="center">pai</h1>

<p align="center">
  <strong>Keys, money, and subagent controls for AI agents</strong><br>
  Built by <a href="https://phantom.codes">Phantom AI</a>
</p>

<p align="center">
  <a href="https://github.com/connortessaro/pai/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/connortessaro/pai/ci.yml?branch=main&label=CI&color=161b22&labelColor=0d1117" alt="CI"></a>&nbsp;
  <a href="https://www.npmjs.com/package/@connortessaro/pai"><img src="https://img.shields.io/npm/v/@connortessaro/pai?label=version&color=161b22&labelColor=0d1117" alt="npm version"></a>&nbsp;
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D24-161b22?labelColor=0d1117" alt="Node >= 24"></a>&nbsp;
  <a href="docs/reference.md#mcp-tools"><img src="https://img.shields.io/badge/MCP-server-161b22?labelColor=0d1117" alt="MCP Compatible"></a>&nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-161b22?labelColor=0d1117" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#install">Install</a> •
  <a href="#quickstart">Quickstart</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#features">Features</a> •
  <a href="#commands">Commands</a> •
  <a href="#use-with-an-mcp-client">MCP Server</a> •
  <a href="https://connortessaro.github.io/pai/">Docs</a>
</p>

---

`pai` runs on your machine and manages a [Phantom AI](https://phantom.codes) key.
Your agent can give each subagent a child key with its own spending limit, lifetime, and rate cap.
`pai` also sets plans and model routing, buys credit from an agent wallet, and checks which model answered a call.

`pi`, `Claude Code`, `Codex`, and `Cursor` drive it through a skill. Any MCP client can use `pai mcp`.

The CLI is MIT licensed. The Phantom AI API it calls is a hosted service.

**Docs:** [connortessaro.github.io/pai](https://connortessaro.github.io/pai/) has guides to how
keys, payments, caps and the local tools behave, the full interface reference (commands,
flags, MCP tools, HTTP calls, environment variables), and the code reference.

## How It Works

```text
                       ┌────────────────────────┐
                       │    Main Phantom Key    │
                       │ (prepaid, no account)  │
                       └───────────┬────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           │ pai child             │ pai child             │ pai wallet
           ▼                       ▼                       ▼
    ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
    │  Researcher  │        │  Code Agent  │        │ Agent Wallet │
    │  Claude Code │        │    Cursor    │        │  (Solana)    │
    │  $0.50 limit │        │  $1.00 limit │        │  auto-topup  │
    │  6 hour TTL  │        │  $0.10 / min │        │  below $1.00 │
    └──────┬───────┘        └──────┬───────┘        └──────────────┘
           │                       │
           └───────────┬───────────┘
                       ▼
           ┌───────────────────────┐
           │    Phantom AI API     │  ──> https://phantom.codes/v1
           │ (stores no prompts)   │  ──> signed receipt per call
           └───────────────────────┘
```

## Features

- **Child keys.** `pai child` creates a key that spends the parent's balance up to a limit, with a lifetime and a per-minute cap. `pai burn` revokes one.
- **Agent wallet.** `pai wallet` keeps Solana wallets on this machine, so an agent can buy its own credit. `PHANTOM_WALLET_MAX_USD` caps each payment, and only the environment can set it.
- **Skill and MCP server.** `pai setup` installs a skill for `pi`, `Claude Code`, `Codex`, and `Cursor`. `pai mcp` runs an MCP server over stdio.
- **Signed receipts.** Phantom AI signs each paid response with the model that answered, the token counts, and the cost. `pai verify` checks that signature.
- **Local tools.** Markdown notes, throwaway Docker containers, and a mail client that drafts by default. None of them send data to Phantom AI.

## Install

```bash
npm i -g @connortessaro/pai
# or, without npm's registry:
npx github:connortessaro/pai --help
```

The package also installs the same CLI as `phantom-key`, its earlier name.

## Quickstart

```bash
# 1. Save your key once, and install the skill for the agents you have
pai login          # paste your key; pai saves it (see Saved secrets below)
pai setup          # sets up pi, Claude Code, Codex, and Cursor, where found

# 2. Check the balance and any caps
pai balance

# 3. Create a child key for a subagent: $0.50, 6 hours, $0.10 a minute
pai child --limit 0.50 --ttl 6 --rate 0.10 --save researcher

# 4. Start the subagent as that child
PHANTOM_KEY_NAME=researcher claude
```

## Use It From an Agent

`pai setup` installs the `phantom-ai` skill for each agent it finds in your
home folder (`pi`, `Claude Code`, `Codex`, `Cursor`). Then you can ask your
agent in plain words, for example:

> *"Give a subagent $0.50 for 6 hours with a $0.10/min rate cap."*

- `--agent pi` (or `claude`, `codex`, `cursor`) sets up one agent.
- `--mcp` also adds the MCP server to Claude Code, Codex, and Cursor.
- `--agent claude --provider` sends Claude Code's own model calls to Phantom AI. It sets `ANTHROPIC_BASE_URL`, turns on tool search, and gives Claude Code the key through `apiKeyHelper` (`pai key show`), so the key stays out of `settings.json`. Add `--model auto` or any model id. `--provider off` undoes it.
- `pi` has no MCP support and uses the CLI through the skill. Install it there with:
  ```bash
  pi install npm:@connortessaro/pai
  ```

## Commands

`pai --help` prints every command and flag. [docs/reference.md](docs/reference.md)
lists every command with the flags it reads, every MCP tool with its inputs, every
call `pai` makes to Phantom AI, and the environment variables. `npm run docs`
writes that file from the code.

| Group | Commands | What they do |
| --- | --- | --- |
| **Setup** | `login`, `logout`, `setup` | Save your key, and install the skill for your agents |
| **Keys** | `balance`, `child`, `children`, `key`, `rotate`, `burn` | Show credit, create child keys paid from this key, save keys by name, and replace or revoke a key |
| **Caps and plans** | `budget`, `plan` | Set a monthly cap and a per-minute cap, or an amount for a set period |
| **Routing** | `route` | Choose which models `model: "auto"` can run, and the rules that pick one |
| **Credit** | `buy`, `payment` | Buy credit with USDC, USDT, or SOL on Solana |
| **Agent wallet** | `wallet`, `autotopup`, `buy --pay` | Keep Solana wallets and pay for credit from them. See [Let the agent pay](#let-the-agent-pay) |
| **Receipts** | `verify` | Check which model answered a call, from its signed receipt |
| **Local tools** | `memory`, `mail`, `browser`, `sandbox` | See the sections below |
| **MCP** | `mcp` | Run an MCP server over stdio. See [Use with an MCP client](#use-with-an-mcp-client) |

A command runs as the saved key named by `PHANTOM_KEY_NAME` if it is set, then
as `PHANTOM_API_KEY`, then as the `login` key. A subagent started with
`PHANTOM_KEY_NAME=<child>` runs as the child even when your parent key is exported.

## Memory

Each agent gets its own notebook on this machine. Notes are markdown files in
`~/.config/phantom-key/memory/<space>/`, so you can read, edit, or commit them.
`pai` sends none of them anywhere.

| Command | What it does |
| --- | --- |
| `memory add "text" [--tag a,b] [--title t]` | Keeps a note. Pipe long notes on stdin |
| `memory search <words> [--tag t] [--any] [--limit n]` | Notes with every word (or any word with `--any`), best match first. Returns 10 by default |
| `memory list [--tag t] [--limit n]` / `memory show <id>` / `memory rm <id>` | The newest notes (50 by default), one note, or delete one |
| `memory spaces` | Each notebook and how many notes it holds |

`pai` picks the notebook from `--space`, then `PAI_MEMORY_SPACE`, then the saved
key name (`PHANTOM_KEY_NAME`), then `main`, so each subagent keeps its own.

## Mail

`pai` reads your own mailbox over IMAP and sends over SMTP, with an app
password. It saves the login as described in [Saved secrets](#saved-secrets).
Gmail, Outlook, iCloud, and Fastmail addresses have presets. For any other
provider, pass `--imap host:port --smtp host:port`.

| Command | What it does |
| --- | --- |
| `mail setup --user you@gmail.com` | Checks the login by listing one message, then saves it. `pai` does not save a wrong password. The password comes from a prompt or `PAI_MAIL_PASSWORD` |
| `mail status` | Shows the mailbox and whether sending is on |
| `mail list [--unread] [--from x] [--limit n] [--folder f]` / `mail search <words>` / `mail read <uid>` | Reads mail from `INBOX` by default. `list` returns 20 messages by default. `read` cuts a message at 20,000 characters |
| `mail draft --to a --subject s [--reply <uid>] [--body "..."]` | Saves a draft in your Drafts folder and sends nothing. Without `--body`, `pai` reads the body from stdin |
| `mail send` (same flags) | Sends only when `PAI_MAIL_SEND=1`, to at most `PAI_MAIL_MAX_PER_DAY` recipients (default 10) in 24 hours, and only to `PAI_MAIL_SEND_TO` (addresses or `@domain`s) when set |

`pai` reads the three `mail send` settings from the environment only, so an
agent can't turn sending on with a flag. While sending is on, the
`create_child_key` MCP tool requires `save_as`, which keeps a new key out of the
agent's context. On any port other than 993 or 465, `pai` requires STARTTLS
(switching the connection to encrypted) before it sends the password.

## Browser and Sandbox

`pai` wraps two existing tools:

| Command | What it does |
| --- | --- |
| `browser setup [--install]` | Checks for [agent-browser](https://github.com/vercel-labs/agent-browser), a headless Chrome built for agents. `--install` installs it with npm |
| `browser <command>` | Runs agent-browser (`open <url>`, `snapshot -i`, `click @e1`, `fill @e2 "text"`, `screenshot`). Each space gets its own session and Chrome profile in `~/.config/phantom-key/browser/<space>/`, so a subagent keeps its own logins. `AGENT_BROWSER_PROFILE=Default` uses your own Chrome profile instead |
| `sandbox check` | Reports whether Docker or Podman is running |
| `sandbox run [--image i] [--net] [--write] [--timeout s] -- <command>` | Runs a command in a throwaway container (default image `node:24-slim`). The container has no network unless `--net`, and mounts this folder read-only unless `--write`. It runs as an unprivileged user with all capabilities dropped, 2 CPUs and 2 GB of memory. It stops after 300 seconds by default and exits 124 on timeout |

## Output Format

Commands print JSON on stdout, so you can pipe them into `jq`. `--table` prints
a table for people to read. `browser` and `sandbox run` pass through the exit
code of the command they ran.

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Any other error |
| `2` | Key rejected (401/403). Get a new key; a retry fails the same way |

## Use With an MCP Client

`pai mcp` starts an MCP server over stdio. Add it to your client's config:

```json
{
  "mcpServers": {
    "phantom": {
      "command": "npx",
      "args": ["-y", "@connortessaro/pai", "mcp"]
    }
  }
}
```

[docs/reference.md](docs/reference.md#mcp-tools) lists each tool with its
inputs, and marks the read-only and destructive ones.

`delete_key` signs in as the key you pass in `api_key` or `key_name` and
deletes that key. It refuses the key the server runs as; use `pai burn` for
that.

## Let the Agent Pay

The agent can keep its own Solana wallets and buy credit with them. Each wallet
is a Solana keypair, saved as described in [Saved secrets](#saved-secrets).
The wallet pays Phantom AI's Solana address, and Phantom AI finds the payment
on chain.

1. **Create a wallet**, and back up its secret key:
   ```bash
   pai wallet create --table              # saved as "main"
   pai wallet create --name work --table  # a second one
   ```
   On macOS the file in `~/.config/phantom-key/wallets/` only points to the
   Keychain, so copying it backs up nothing. Export the key itself:
   ```bash
   security find-generic-password -s pai -w \
     -a "$(cut -d: -f2 ~/.config/phantom-key/wallets/main.json)" | base64 -d > main-backup.json
   ```
   With `PAI_KEYCHAIN=0`, or on other systems, `wallets/main.json` holds the key, and a copy of it is the backup.
2. **Fund the address** with USDC on Solana, plus about 0.003 SOL for fees.
3. **Set the safety cap**:
   ```bash
   export PHANTOM_WALLET_MAX_USD=10
   ```
   Without this variable, `pai` refuses to pay. `PHANTOM_WALLET_MAX_USD_PER_DAY`
   caps the total over 24 hours and defaults to the same amount, which allows
   one payment a day. Raise it for `autotopup`.
4. **Pay**:
   ```bash
   pai buy --amount 5 --pay
   ```
   With more than one wallet saved, `pai` asks in a terminal which one pays. It
   then reports each step:
   1. Getting a payment request from Phantom AI (amount, recipient, and a unique reference)
   2. Sending USDC or SOL from your wallet
   3. Confirming on Solana
   4. Phantom AI finding the payment on chain by its reference
   5. Credit balance before and after

   A payment request expires after 30 minutes.

You can also ask your agent: *"Top up my Phantom AI key with $5 from my Phantom agent wallet."*
Over MCP it calls `list_wallets`, asks which wallet if you didn't say, then calls `pay_for_credit`.

To refill when the balance runs low:

```bash
pai autotopup --below 1 --amount 5 --wallet main --every 10
```

### Safeguards

- `pai` pays the recipient and exact amount the payment request names, with that request's reference attached.
- `pai` reads `PHANTOM_WALLET_MAX_USD` and `PHANTOM_WALLET_MAX_USD_PER_DAY` from the environment only; no flag or tool argument can raise them.
- Before signing, `pai` checks the payment request against what it asked for: the coin, the USDC mint, and an amount no more than requested (for SOL, within 10% of Coinbase's price). A wrong or hostile `PHANTOM_BASE_URL` cannot make it sign more.
- `pai` runs one payment at a time, across processes.
- `pai` checks the wallet balance before it asks for a payment request.
- `pai` records each payment in `~/.config/phantom-key` before sending, and keeps the record until Phantom AI reports the payment credited or dead. If a run crashes, times out, or loses the connection, the next run waits for that payment instead of paying again.
- These limits bind an agent that reaches `pai` through MCP. An agent with its own shell can set environment variables and edit the state folder, so give such an agent a wallet that holds only what you are willing to let it spend.
- To keep a wallet's secret out of `pai`'s state folder, pass it at run time in `PHANTOM_WALLET_KEY`, for example from a local secrets manager such as [KRU](https://github.com/omaekumiko2-create/kru).

## Saved Secrets

`pai` keeps its files in `~/.config/phantom-key`, or in `PHANTOM_STATE_DIR` if
you set it. The paths in this README assume the default.

On macOS, `pai` puts saved keys, wallets, and the mail login in your login
Keychain. The file in the state folder then holds only a pointer to the
Keychain item. The Keychain keeps these secrets out of files, backups, and sync
folders. Any program running as you can still read them. If the Keychain is
locked, as it often is over SSH, run `security unlock-keychain`.

Set `PAI_KEYCHAIN=0` to save them to files instead. On other systems `pai`
uses files. Only your user can read them (mode 600).

## Configuration

`pai` reads its settings from environment variables. Run `pai --help` or see
[docs/reference.md](docs/reference.md#environment-variables) for the full list,
including secrets, environment-only settings, and caps.

`PHANTOM_BASE_URL` must start with `https://`. `pai` sends your API key there,
so it refuses plain `http://`, even on localhost.

## Requirements

- **Node 24** or newer
- Runtime dependencies: `@modelcontextprotocol/sdk` and `zod` for `mcp`, `@solana/kit` for wallet payments, and `imapflow`, `mailparser`, and `nodemailer` for `mail`.

[phantom.codes/docs/concepts](https://phantom.codes/docs/concepts) explains how keys and child keys work on the Phantom AI side.

## Development

```bash
npm ci
npm run build                     # compile src/ to dist/
npm run typecheck
npm test                          # vitest; never touches the real Keychain
npm run coverage                  # vitest with coverage; fails under 80%
npm run docs                      # rewrite docs/reference.md and build the docs site in docs/site (not committed)
node scripts/gen-docs.mjs --check # fail if docs/reference.md is out of date or the docs disagree with the code
node src/pai.mts --help           # run from source
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, style, and how to add a
command or MCP tool. [CHANGELOG.md](CHANGELOG.md) lists changes by release.

## Security

Report vulnerabilities through a private
[GitHub security advisory](https://github.com/connortessaro/pai/security/advisories/new).
See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
