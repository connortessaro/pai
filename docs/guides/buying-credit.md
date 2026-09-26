---
title: Buying credit and the pending payment
group: Guides
---

# Buying credit and the pending payment

This guide covers buying credit with crypto, checking a payment, and the record that stops a wallet from paying twice for the same credit.

## Buying with a wallet you control

```bash
pai buy --amount 5                 # USDC on Solana
pai buy --amount 5 --coin sol
pai buy --amount 5 --wait          # wait until the credit lands
```

`--coin` takes `usdc` (the default), `usdt` or `sol`, in any case. `usdcsol` and `usdtsol` are older spellings of `usdc` and `usdt` ({@link parseBuyCoin}).

pai asks Phantom AI for a payment request for this key ({@link requestSolanaPayment}). The answer names the address to pay, the exact amount, a Solana Pay link, a `reference` (an address Phantom AI finds the payment by on chain), an expiry and a `payment_id` ({@link SolanaPaymentRequest}). You send the coins from any wallet. Nothing is charged until someone sends them.

With `--wait`, pai prints the request on stderr, so stdout stays one JSON document, and then asks Phantom AI for the payment's status every 10 seconds, for up to 65 minutes ({@link waitForPayment}):

| Status | What pai does |
| --- | --- |
| `completed` or `finished`, or `topped_up` is true | stops and prints the result |
| `expired`, `failed` or `refunded` | stops with the error code `payment_<status>` |
| anything else | prints the new status on stderr and keeps waiting |

If 65 minutes pass, pai stops with `payment_timeout` and tells you to run `pai payment <id>`.

## Checking a payment

```bash
pai payment <payment_id>
pai payment <payment_id> --wait
```

The MCP tools are `buy_credit` and `check_payment`. `topped_up` turns true once the credit is on the key ({@link getPaymentStatus}).

When a payment request comes with a `recovery_code`, `buy --wait` and wallet payments send it to Phantom AI in the `x-phantom-recovery-code` header when they ask for the status. `pai payment` sends no recovery code.

## Paying from an agent wallet

```bash
pai buy --amount 5 --pay [--coin usdc|sol] [--wallet <name>]
```

With `--pay`, pai pays from one of its own wallets and waits for the credit ({@link buyAndPay}). The coin must be `usdc` or `sol`. The MCP tool is `pay_for_credit`. [Agent wallets and spending caps](./agent-wallet.md) covers setting up a wallet, the caps, and the checks pai runs on the payment request before signing.

In order, pai:

1. checks the amount against `PHANTOM_WALLET_MAX_USD`, picks the wallet, and reads the key's balance,
2. takes the wallet lock and looks for a pending record for this key,
3. with no record, checks the daily cap and the wallet's balance, gets a payment request, and checks it,
4. writes the pending record,
5. sends the coins and waits up to 2 minutes for Solana to confirm the transaction,
6. releases the lock and waits for Phantom AI to add the credit, as `--wait` does,
7. reports the balance before and after ({@link SelfPayResult}).

## Why a wallet payment never pays twice

Once coins leave the wallet, paying again for the same credit is the costly mistake. A crash, a dropped connection or a slow confirmation can all end a run after the money moved but before the credit showed up. pai guards against that in three ways.

**The record comes first.** pai writes the pending record before it sends any coins. The file is `pending-<id>.json` in the state folder, where `<id>` is the start of a hash of the API key, so each key has its own. It holds the `payment_id`, the recovery code and the start time.

**The next run waits.** When a run finds a pending record, it sends nothing new. It waits for that payment, reports it with `resumed: true`, and ignores the amount you asked for this time. Run the command again once it finishes to buy more.

**The record stays until Phantom AI answers.** The record has no time limit. pai deletes it only when:

- Phantom AI reports the credit added, or reports the payment `expired`, `failed` or `refunded`, or
- sending fails in a way that means no coins left the wallet: the wallet held too little (`wallet_insufficient`), the coin wasn't one the wallet pays in (`wallet_coin`), or Solana rejected the transaction (`wallet_tx_failed`).

Any other failure keeps the record: a transaction Solana didn't confirm within 2 minutes (`wallet_tx_unconfirmed`), a lost connection, a status check that failed, or `waitForPayment` giving up. When the failure comes during the send, pai also counts the amount toward the daily cap, since the money may have gone.

If the record exists but pai can't read it, pai refuses to pay and stops with `pending_corrupt`. A record it can't read may describe a payment already sent. Check the wallet's history on Solana, then delete the file by hand.

## One payment at a time

Two runs that check for a record at the same moment could both find none and both pay. pai prevents that with a lock file, `wallet.lock` in the state folder, held from the record check through the send. A second run that finds the lock stops with `wallet_busy`. A lock older than 10 minutes belongs to a process that died, and the next run takes it over.
