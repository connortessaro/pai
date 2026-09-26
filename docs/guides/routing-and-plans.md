---
title: Routing and plans
group: Guides
---

# Routing and plans

This guide covers spending caps and plans on a key, and the route policy that decides which model a request for `model: "auto"` runs.

Phantom AI stores and enforces all of this on its side. pai sends the settings and prints what Phantom AI returns. Where this guide describes how Phantom AI applies a setting, it describes the server's code at the time of writing.

## Caps and plans

A key has one spending cap for a period, plus an optional per-minute cap. `budget` and `plan` are two views of the same cap ({@link getBudget}, {@link BudgetResult}):

```bash
pai budget                              # the cap, the per-minute cap, and spend against each
pai budget set --budget 20 --rate 0.5   # a cap for the period, and a per-minute cap
pai budget clear                        # remove both caps

pai plan                                # the cap as a plan: amount, spent, pace, per day left, days left
pai plan set --amount 20 --days 30      # $20 over 30 days
pai plan set --amount 20                # $20 over one calendar month
pai plan clear                          # remove the plan
```

`budget set` sends `budget_usd` and `rate_usd_per_min` ({@link setBudget}). `plan set` sends `budget_usd` and `period_days`, with `null` for a calendar month ({@link setPlan}). Both go to `PATCH /key/budget`.

On Phantom AI's side:

- Setting an amount starts a fresh period from now, with nothing spent.
- Changing only the period length keeps the start date and the spend so far.
- `budget set` and `budget clear` send no `period_days`, so a length set with `plan set --days` stays. The period is a calendar month only while no length is set.
- When the period's spend reaches the cap, Phantom AI refuses requests with `budget_exceeded`. The credit on the key stays. A route policy with `on_empty: "cheapest"` lets `auto` keep running on the cheapest model instead.
- A child key can read its caps but not change them.

### Pace

`plan` reports a pace. Phantom AI draws an even line from the start of the period to the end: by halfway through, an even spend has used half the amount (`allowed_so_far_usd`). The pace reads `ahead` when the spend passes that line plus some slack (one day's share, or a tenth of the period if that is shorter), and `on_pace` otherwise. Once `ahead`, it stays `ahead` until the spend falls back under the line itself, so a key spending right at the line doesn't flip on every call. `daily_allowance_usd` spreads what is left over the days left.

The MCP tools are `get_budget`, `set_budget`, `plan_status` and `set_plan`.

## Route policy

A request for `model: "auto"` needs a route policy on the key. Without one, Phantom AI refuses it. A policy names the models `auto` may run and the rules that pick one ({@link RoutePolicy}, {@link RouteRule}):

| Field | Meaning | Phantom AI's default |
| --- | --- | --- |
| `models` | the models `auto` may run; the first is the default | required |
| `applies_to` | `auto` routes only requests for `auto`; `all` routes named models too | `auto` |
| `rules` | checked in order; the first one that matches picks the model | none |
| `on_empty` | when the cap is used up: `stop` refuses, `cheapest` runs the cheapest model in `models` | `stop` |
| `fallback_on_error` | if the chosen model fails, try the other models | `false` |
| `stick_minutes` | keep a conversation on its model this many minutes after its last request; `0` turns it off | `5` |
| `stick_by_prompt` | recognise a conversation by its opening when it sends no `x-phantom-session` header | `true` |

### Rules

Each rule has one condition in `if` and a model in `use`:

| Condition | Matches when |
| --- | --- |
| `pace` | the plan's pace is `on_pace` or `ahead` (never, with no plan) |
| `budget_left_pct_below` | less than this percent of the cap is left |
| `days_left_below` | fewer than this many days are left in the period |
| `has_tools` | the request does (`true`) or doesn't (`false`) send tools |
| `input_tokens_over` | the prompt is estimated at more than this many tokens |
| `reasoning_requested` | the request does or doesn't ask for reasoning |

`use` names a model from `models`, or one of:

- `cheapest`: the model in `models` with the lowest input plus output price,
- `first`: the first model in `models`,
- `next`: the model after the one requested in `models`, wrapping around; for `auto`, the second model.

With no match, `auto` runs the first model, and a named model (under `applies_to: "all"`) runs as asked.

### Setting a policy

```bash
pai route                                          # show the policy
pai route set --models <model-a>,<model-b>        # the first is the default
pai route set --on-empty cheapest --fallback       # change two fields, keep the rest
pai route set --file policy.json                   # replace the whole policy
pai route rule add --if pace=ahead --use cheapest  # add a rule at the end
pai route rule add --if has_tools=true --use first --at 1   # add it first
pai route rule rm 2                                # remove rule 2
pai route clear                                    # remove the policy
```

`route set` with flags reads the current policy first. When one exists, pai sends only the fields you gave, and Phantom AI keeps the rest ({@link patchRoute}). When none exists, pai sends the fields as a new policy ({@link putRoute}), so the first `route set` needs `--models`. `--file` always replaces the whole policy.

`--fallback` and `--stick-by-prompt` turn a field on; follow them with `false` to turn it off.

`route rule add` needs a policy already. pai reads `--if name=value` into one condition: `true` and `false` become true and false, a number becomes a number, and anything else stays text ({@link parseCondition}). `--at n` puts the rule at position n, counting from 1. pai then sends the whole new list of rules.

Phantom AI checks every policy before saving it: from one to ten models, up to 20 rules, one condition per rule, and a `use` that names one of `models` or `cheapest`, `first` or `next`. A child key can read its policy but not change it.

### Testing

```bash
pai route test                # what "auto" would run now, and the rule that picked it
pai route test --model <id>   # the same for a named model
```

`route test` runs Phantom AI's router against the key's current cap and pace. Phantom AI calls no model and charges nothing ({@link testRoute}). pai sends only the model name, so conditions about the request itself (`has_tools`, `input_tokens_over`, `reasoning_requested`) see an empty request. The MCP tool `test_route` does the same.

### Conversations that stay on one model

Switching models mid-conversation throws away the prompt cache, the discount a provider gives for repeating the start of a prompt. With `stick_minutes` above 0, Phantom AI keeps a conversation on the model it last ran unless the rules' pick costs less even against the cached price.

Phantom AI tells conversations apart by the `x-phantom-session` header your own inference requests send. Without the header, and with `stick_by_prompt` on, it uses a hash of the conversation's opening, held in memory. pai sends no `x-phantom-session` header: it makes no inference calls apart from `verify`. Add the header in the client your agent uses to call Phantom AI.

A request with the header `x-phantom-route: off` skips routing; a request for `auto` with that header is refused.

The MCP tools are `get_route`, `set_route` (pass `policy: null` to remove it, or `merge: true` to change some fields) and `test_route`.
