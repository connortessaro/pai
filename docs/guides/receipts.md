---
title: Receipts and verify
group: Guides
---

# Receipts and verify

This guide covers the signed receipt Phantom AI returns with each priced call, and how `pai verify` checks it on your machine.

## What a receipt says

Phantom AI signs each priced response with its Ed25519 key (a common digital signature scheme). The receipt names the model you asked for, the model that answered, the token counts including reasoning tokens, and the cost in millionths of a dollar ({@link Receipt}). Phantom AI's version also carries hashes of the request and the response, and doesn't store the receipt.

A receipt arrives in one of two places:

- the `x-phantom-receipt` response header, for a normal response,
- an event named `phantom.receipt`, sent right before `data: [DONE]`, for a streamed response.

Either way it is one string: `payload.signature`, both parts base64url-encoded (base64 with URL-safe characters).

## Checking a model

```bash
pai verify --model deepseek/deepseek-v3.2
```

pai makes one small call to that model with your key: the prompt `Reply with ok.`, capped at 16 output tokens. It costs a fraction of a cent. Then it reads the receipt from the `x-phantom-receipt` header and checks it ({@link verifyModel}).

The result ({@link VerifyModelResult}):

| Field | Meaning |
| --- | --- |
| `model_served` | the model the receipt says answered |
| `match` | true when the signature is valid and the served model is the one you asked for |
| `signature_valid` | the signature matches Phantom AI's published key |
| `cost_usd` | the call's cost, from the receipt |
| `receipt` | the receipt itself, to keep or check again |
| `reason` | why the check failed, when it did |

The command exits 0 on a match and 1 otherwise, so a script can act on it. A response with no receipt gives `match: false` and the reason `The response carried no receipt`.

### When two model names match

The served id sometimes drops the provider prefix. pai counts two ids as a match when they are equal ignoring case, or when the part after the last `/` is equal ({@link modelsMatch}). `deepseek/deepseek-v3.2` matches `deepseek-v3.2`. The same rule also matches two providers that serve a model under the same short name.

## Checking a receipt you have

```bash
pai verify --receipt "<payload.signature>"
```

This needs no API key. It exits 0 when the signature is valid and 1 when it isn't ({@link checkReceipt}, {@link ReceiptCheck}).

## How the check works

pai does the check itself, so the verdict never comes from Phantom AI saying it was honest:

1. It fetches the public key from `GET /receipts/key` at your base URL, with no API key.
2. If that answer says the deployment signs no receipts, the check fails with `This deployment signs no receipts`.
3. It splits the receipt at the `.`, decodes the payload, and reads it as JSON.
4. It refuses any version other than 1.
5. It checks the Ed25519 signature over the payload bytes against the public key.

The public key comes from the same base URL as your calls. The check proves the server at `PHANTOM_BASE_URL` signed the receipt. See [The API address](./base-url.md).

The MCP tools are `verify_model` (costs a fraction of a cent, needs the key) and `verify_receipt` (free, needs no key).
