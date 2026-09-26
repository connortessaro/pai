---
title: Autotopup
group: Guides
---

# Autotopup

This guide covers `pai autotopup`, which buys credit from an agent wallet when the key's balance runs low.

```bash
pai autotopup --below 1 --amount 5                        # check once
pai autotopup --below 1 --amount 5 --wallet main --every 10   # check every 10 minutes
```

| Flag | Meaning |
| --- | --- |
| `--below <usd>` | buy when the balance is under this. Required |
| `--amount <usd>` | how much to buy. Required |
| `--coin usdc\|sol` | the coin the wallet pays in. Default `usdc` |
| `--wallet <name>` | which saved wallet pays |
| `--every <minutes>` | keep checking on this interval instead of running once |

## When it buys

Each check reads the key's balance and buys only when one of these holds ({@link autoTopup}):

- the balance is under `--below`, or
- a pending wallet payment exists for this key.

The second case finishes a payment an earlier run sent but didn't see credited. The check then waits for that payment and sends nothing new. [Buying credit](./buying-credit.md) explains the pending record.

A purchase runs the same steps as `pai buy --pay` ({@link buyAndPay}). The result reports the balance, the threshold, whether it bought, and the payment when there was one ({@link AutoTopupResult}).

pai checks that `PHANTOM_WALLET_MAX_USD` is set before it reads the balance, so a missing cap fails on the first check, even when the balance is high.

autotopup never asks which wallet pays. With several wallets saved, pass `--wallet`, set `PHANTOM_WALLET`, or set a default with `pai wallet use`. See [Agent wallets and spending caps](./agent-wallet.md).

## Running on an interval

With `--every`, pai checks, prints one JSON result, sleeps for the interval, and repeats until you stop it. An error on one check prints as JSON on stderr, and the next check runs on schedule.

## The daily cap

`PHANTOM_WALLET_MAX_USD_PER_DAY` defaults to `PHANTOM_WALLET_MAX_USD`, which allows one full payment in any 24 hours. When autotopup needs to buy more often, raise the daily cap:

```bash
export PHANTOM_WALLET_MAX_USD=5
export PHANTOM_WALLET_MAX_USD_PER_DAY=20
```

A check that would pass the daily cap fails with `wallet_daily_cap_exceeded`. With `--every`, the loop keeps going and buys again once older payments fall out of the 24 hours.

## Over MCP

The tool `auto_top_up` takes `below_usd`, `amount_usd`, and optional `coin` and `wallet`. It checks once.
