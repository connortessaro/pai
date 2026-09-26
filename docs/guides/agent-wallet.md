---
title: Agent wallets and spending caps
group: Guides
---

# Agent wallets and spending caps

This guide covers the Solana wallets pai keeps so an agent can buy its own credit, how pai picks the wallet that pays, and the caps that limit what it may spend.

A wallet is a plain Solana keypair on your machine. No third party holds it. It pays Phantom AI's address and nothing else: the only payee is the one the Phantom AI purchase API returns.

## Setting up

```bash
pai wallet create                  # saved as "main"
pai wallet create --name work      # a second one
pai wallet list                    # every saved wallet, with its SOL and USDC balance
pai wallet use work                # pay from "work" unless told otherwise
pai wallet [--wallet <name>]       # one wallet's address and balance
```

`wallet create` never overwrites: if the name exists, it shows that wallet and reports `created: false` ({@link createWallet}). The first wallet you save becomes the default. `wallet use` writes the default's name to `wallets/.default` ({@link useWallet}). Wallet names follow the same rules as key names: letters, numbers, `-` and `_`, up to 32 characters.

Fund the wallet's address with USDC on Solana, plus about 0.003 SOL for fees. [Saved secrets](./saved-secrets.md) covers where the secret key is stored and how to back it up.

The MCP tools are `list_wallets` and `wallet_status`.

## Which wallet pays

pai takes the first of these that is set ({@link resolveWalletName}):

1. `PHANTOM_WALLET_KEY`: a secret key in the environment, base58 (the format wallet apps export) or a JSON array of bytes (the format `solana-keygen` writes),
2. `PHANTOM_WALLET_FILE`: a keypair file in either format,
3. the name you pass: `--wallet <name>`, or `wallet` in a tool call,
4. `PHANTOM_WALLET`: the name of a saved wallet,
5. the default set by `wallet use` or the first `wallet create`,
6. the only saved wallet, when you have one.

With no wallet at all, pai stops with `wallet_missing`. With several saved and nothing above to choose between them, it stops with `wallet_ambiguous` and lists the names. In a terminal, `pai buy --pay` asks you to pick instead.

The secret must be 64 bytes, as Solana secret keys are ({@link parseWalletSecret}). `PHANTOM_WALLET_KEY` keeps the secret out of the state folder altogether; a local secrets manager can set it at run time so the model never sees it.

## The spending caps

Two environment variables limit what a wallet may spend. pai reads them from the environment and nowhere else, so no flag or tool argument can raise them.

| Variable | Limit |
| --- | --- |
| `PHANTOM_WALLET_MAX_USD` | the most one payment may spend. Required: without it pai refuses to pay (`wallet_cap_missing`) |
| `PHANTOM_WALLET_MAX_USD_PER_DAY` | the most all wallets together may spend in 24 hours. Defaults to `PHANTOM_WALLET_MAX_USD`, which allows one full payment a day |

```bash
export PHANTOM_WALLET_MAX_USD=10
export PHANTOM_WALLET_MAX_USD_PER_DAY=30
```

Both must be positive numbers ({@link walletCap}, {@link walletDailyCap}). A payment over the first stops with `wallet_cap_exceeded`, and one that would take the last 24 hours past the second stops with `wallet_daily_cap_exceeded`.

The 24 hours roll: pai adds up the payments in `wallet-spent.log` in the state folder whose time falls within the last 24 hours ({@link walletSpentToday}). Each line holds the time in milliseconds and the dollar amount. pai compares the totals in millionths of a dollar, so rounding in decimal numbers can't push an amount that fits over the cap.

## Checks before signing

The wallet signs the amount, coin and address the payment request names, all taken from Phantom AI's answer. pai checks that answer against what it asked for before it signs anything ({@link checkPaymentRequest}), so a wrong or hostile `PHANTOM_BASE_URL` can't make the wallet sign more:

- the coin matches the one asked for,
- the recipient and the reference are valid Solana addresses,
- the amount is a whole number of base units above zero,
- for USDC: the mint (the token's address on Solana), when the request names one, is the USDC mint for the network, and the amount is no more than the dollars asked for,
- for SOL: no mint, and the amount is worth no more than the dollars asked for plus 10%, at Coinbase's current SOL price.

If pai can't get a price from Coinbase, it refuses a SOL payment (`wallet_price_unavailable`). A mismatch stops with `wallet_request_mismatch`.

Before it asks for a payment request, pai checks the wallet holds about 0.003 SOL for fees and, for USDC, at least the amount in USDC, so an empty wallet leaves no unpaid request behind. A SOL payment needs the amount plus that 0.003 SOL. Too little stops with `wallet_insufficient`.

A USDC payment also creates Phantom AI's token account when it doesn't exist yet, paid for by your wallet, and does nothing when it does. [Buying credit](./buying-credit.md) covers the rest of the payment, including the record that stops a second payment.

## Network

| Variable | Meaning |
| --- | --- |
| `PHANTOM_SOLANA_NETWORK` | `devnet` for Solana's test network; anything else means mainnet |
| `PHANTOM_SOLANA_RPC` | the Solana server pai talks to. Defaults to `https://api.mainnet-beta.solana.com` or `https://api.devnet.solana.com` |

## What the caps can and can't stop

The caps bind an agent that reaches pai only through MCP. An agent that can run shell commands, as it does when it drives the CLI through the skill, can set environment variables and edit the state folder, `wallet-spent.log` included. Give such an agent a wallet that holds only what you are willing to let it spend.
