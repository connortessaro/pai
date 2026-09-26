---
title: The API address
group: Guides
---

# The API address

This guide covers `PHANTOM_BASE_URL`, the address pai sends every Phantom AI call to, and why pai accepts only `https://` there.

## The default

pai calls `https://phantom.codes/v1` ({@link DEFAULT_BASE_URL}). Set `PHANTOM_BASE_URL` to use another Phantom AI deployment:

```bash
export PHANTOM_BASE_URL=https://phantom.example.org/v1
```

The paths in the [interface reference](../reference.md) are relative to this address.

## https only

pai sends your API key with each call, so it refuses any address that doesn't start with `https://` ({@link httpsOnly}). That includes `http://localhost`: there is no exception for your own machine.

| Problem | Error code |
| --- | --- |
| the value isn't a web address | `base_url_invalid` |
| the address isn't `https://` | `base_url_insecure` |

The check runs every time pai builds a Phantom AI address: each API call, fetching the receipt key for `verify`, and `pai setup --agent claude --provider`, which writes the address into Claude Code's settings as `ANTHROPIC_BASE_URL` without the trailing `/v1` ({@link claudeProvider}).

## What the address can't do

A wrong or hostile address still can't make an agent wallet sign more than you asked for: pai checks the payment request it gets back before signing. See [Agent wallets and spending caps](./agent-wallet.md).

It can serve its own receipt key, since `verify` fetches the key from the same address. A valid receipt proves the server at `PHANTOM_BASE_URL` signed it. See [Receipts and verify](./receipts.md).

## Other addresses pai calls

These carry no API key, and the https rule doesn't cover them:

- the Solana server in `PHANTOM_SOLANA_RPC`, or Solana's public one for the network,
- `https://api.coinbase.com/v2/prices/SOL-USD/spot`, for the SOL price check before a SOL payment,
- your mail servers, under the rules in [Mail](./mail.md).
