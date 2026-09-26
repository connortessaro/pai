pai runs on your machine and manages a [Phantom AI](https://phantom.codes) key. Your agent can give each subagent a child key with its own spending limit, lifetime and rate cap. pai also sets plans and model routing, buys credit from an agent wallet, and checks which model answered a call. It runs as a CLI, as an MCP server (`pai mcp`), and through a skill for pi, Claude Code, Codex and Cursor.

```bash
npm i -g @connortessaro/pai
pai login     # paste your key
pai balance
```

## Guides

How pai behaves, one topic each:

- [Which key a command runs as](./guides/which-key.md)
- [Saved secrets and the macOS Keychain](./guides/saved-secrets.md)
- [Child keys](./guides/child-keys.md)
- [Buying credit and the pending payment](./guides/buying-credit.md)
- [Agent wallets and spending caps](./guides/agent-wallet.md)
- [Autotopup](./guides/autotopup.md)
- [Routing and plans](./guides/routing-and-plans.md)
- [Receipts and verify](./guides/receipts.md)
- [Memory spaces](./guides/memory.md)
- [Browser and sandbox](./guides/browser-and-sandbox.md)
- [Mail and its limits](./guides/mail.md)
- [The API address](./guides/base-url.md)

## Reference

- [Interface reference](./reference.md): every command and the flags it reads, every MCP tool with its inputs, every call pai makes to Phantom AI, and every environment variable. Generated from the code.
- Code reference: every function, type and constant `src/pai.mts` exports, in the sidebar and the index below. The CLI starts at `run` and the MCP server at `createMcpServer`.

Source, issues and releases: [github.com/connortessaro/pai](https://github.com/connortessaro/pai).
