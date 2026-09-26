---
title: Mail and its limits
group: Guides
---

# Mail and its limits

This guide covers connecting your own mailbox, what an agent can do with it, and the limits on sending. Mail commands need no Phantom AI key and send nothing to Phantom AI.

pai reads over IMAP and sends over SMTP (the standard protocols for reading and sending mail), with the account you already have and an app password.

## Setup

```bash
pai mail setup --user you@gmail.com
pai mail setup --user you@example.org --imap imap.example.org:993 --smtp smtp.example.org:465
```

Addresses at `gmail.com`, `googlemail.com`, `outlook.com`, `hotmail.com`, `icloud.com`, `me.com` and `fastmail.com` have server presets. Any other address needs `--imap` and `--smtp`, written `host` or `host:port`; the port defaults to 993 ({@link parseServer}, {@link buildMailConfig}).

pai takes the password from `PAI_MAIL_PASSWORD`, or reads one line from standard input, with a prompt in a terminal. For Gmail that is an app password from `myaccount.google.com/apppasswords`.

Before saving, pai signs in and lists one message, so a wrong password never gets saved. It saves the login to `mail.json` in the state folder, or to the macOS Keychain with a pointer in `mail.json`. See [Saved secrets](./saved-secrets.md).

## Encryption rules

| Port | Connection |
| --- | --- |
| 993 or 465 | encrypted from the first byte |
| any other | pai requires STARTTLS, the step that switches the connection to encrypted, before it sends the password |

pai refuses to go on when the server doesn't offer STARTTLS. A network that strips the offer gets no password.

`mail setup --insecure` turns that rule off and allows a plain-text login, for a local test server only. It applies to both servers given with `--imap` and `--smtp`.

## Reading and drafting

```bash
pai mail status                          # which mailbox, and whether sending is on
pai mail list [--unread] [--from x] [--limit n] [--folder f]
pai mail search <words>                  # words in the subject or body
pai mail read <uid>
pai mail draft --to a@example.com --subject "Notes" --body "..."
pai mail draft --reply <uid> --body "..."   # answers a message
```

- `list` and `search` read `INBOX` unless you pass `--folder`, and return the newest 20 messages unless you pass `--limit` ({@link mailList}).
- `read` returns one message as plain text, cut at 20,000 characters so one message can't fill an agent's context. Attachments show as names and sizes only ({@link mailRead}).
- `draft` saves to the account's Drafts folder, creating a folder named `Drafts` if the account has none. Nothing is sent. Without `--body`, pai reads the body from standard input. `--reply <uid>` fills in the sender as `--to`, `Re: <subject>` as the subject, and the headers that thread the answer ({@link mailDraft}).

Mail comes from other people. The MCP tools that return mail tell the agent to treat its contents as data and never as instructions.

The MCP tools are `mail_list`, `mail_read`, `mail_draft` and `mail_send`.

## Sending

`pai mail send` takes the same flags as `draft`. pai sends only when every one of these holds ({@link mailSend}):

1. **You turned sending on.** `PAI_MAIL_SEND=1`. Otherwise pai stops with `mail_send_off` and suggests a draft.
2. **Every recipient is allowed.** `PAI_MAIL_SEND_TO` lists addresses and `@domain` entries, separated by commas. An address must match in full; `@example.com` matches any address ending in `@example.com`, and no subdomain. Unset, it allows anyone. A refused recipient stops the send with `mail_recipient_refused` ({@link mailAllowed}).
3. **Today's cap has room.** `PAI_MAIL_MAX_PER_DAY` caps the recipients in any 24 hours, 10 by default. A value that isn't a positive number allows none. Going over stops with `mail_send_cap` ({@link mailSendLimit}).

pai reads all three from the environment only, so an agent can't turn sending on or raise the cap with a flag or a tool argument.

The `to` field takes several addresses separated by commas or semicolons, in the form `a@x.test` or `Name <a@x.test>`. pai refuses anything else with `mail_recipient_invalid`, so the allowlist and the cap see every recipient ({@link mailRecipients}).

### How the cap counts

The cap counts recipients: a message to three people uses three. pai keeps one line per recipient, holding the send time, in `mail-sent.log` in the state folder.

pai sends one message at a time. It holds the lock file `mail.lock` while it checks the cap and sends, writes the recipients to the log before sending, and removes them again if the send fails, so a failed send doesn't count. A second send while the lock is held stops with `mail_busy`. A lock older than 10 minutes belongs to a process that died, and the next send takes it over.

### Keys and mail

While sending is on, the MCP tool `create_child_key` refuses to return a new key in its reply. Pass `save_as` so the key goes to a file and stays out of the agent's context. See [Child keys](./child-keys.md).
