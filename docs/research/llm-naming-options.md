# Cheapest way to get an LLM-suggested name

Research for issue #4. Date of research: 2026-10-10. Claude Code version tested: 2.1.296.

## Question

Sprout takes a one-line description of an experiment. It needs a short name for the experiment directory slug. What is the cheapest reliable way for a CLI to get that name from an LLM?

This note stays language-neutral. Every option below is a process call or an HTTPS call that any language can make.

## Short answer

- `claude -p --model haiku`, with tools, settings, and MCP turned off, takes about 1.8 seconds. It costs nothing extra on a subscription. It works only for users who have Claude Code installed and signed in.
- A direct Messages API call to `claude-haiku-5-5` costs about $0.00002 per call. It needs an API key and works for anyone with one.
- Plain `claude -p --model haiku`, with default settings, is the slow and costly form. It took 3.5 to 4.2 seconds in this test. Its input grew to about 38,000 tokens on George's machine.
- Offline, an untuned `claude -p` can hang for almost three minutes before it fails. That is a retry setting you can change.

## Method

I ran real `claude -p` calls from an empty directory on George's macOS machine. Each call asked for a 2-4 word kebab-case name. The test description was "a script that benchmarks sqlite vs duckdb on csv imports". I timed wall-clock seconds with a Python timer. I read token counts and cost from `--output-format json`.

`ANTHROPIC_API_KEY` is not set on this machine. I made no direct API calls. API figures come from the docs and are marked as such.

Latency numbers are single runs. Treat them as rough. Cost figures from Claude Code are client-side estimates at list price, not a bill ([headless docs](https://code.claude.com/docs/en/headless#pipe-data-through-claude)).

## Option A: `claude -p` (headless Claude Code)

### Setup

- Install Claude Code and sign in once with `/login`.
- Call `claude -p "<prompt>"` and read stdout.
- Credentials come from the macOS Keychain. See [authentication](https://code.claude.com/docs/en/authentication#credential-management).

### Flags that make it fast and cheap

All flags below appear in `claude --help` (version 2.1.296).

| Flag | Effect |
| --- | --- |
| `--model haiku` | The alias `haiku` resolves to Haiku 5.5 on the Anthropic API ([model config](https://code.claude.com/docs/en/model-config)). The JSON output confirmed `claude-haiku-5-5`. |
| `--tools ""` | Disables all built-in tools. |
| `--strict-mcp-config` | Ignores all MCP servers unless `--mcp-config` names them. |
| `--setting-sources ""` | Loads no user, project, or local settings. |
| `--disable-slash-commands` | Disables all skills. |
| `--system-prompt "<text>"` | Replaces the default system prompt. |
| `--no-session-persistence` | Does not save the session to disk. |
| `--output-format json` | Returns one JSON object with `result`, `total_cost_usd`, and `usage`. |
| `--json-schema '<schema>'` | Returns validated output in the `structured_output` field ([headless docs](https://code.claude.com/docs/en/headless#get-structured-output)). |
| `--effort low` | Lowers reasoning effort. |

`--bare` is the documented fast mode. It skips hooks, plugins, MCP, memory, and CLAUDE.md. But it never reads the subscription login. It needs `ANTHROPIC_API_KEY` or an `apiKeyHelper` ([headless docs](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)). I confirmed this:

```
$ claude --bare -p --model haiku "<prompt>"
Not logged in · Please run /login      (0.52 s)
```

So `--bare` is not an option for a subscription-only user.

### Measured latency and cost

Prompt: "Suggest a 2-4 word kebab-case name for: ... Reply with the name only."

| Variant | Wall time | Cost per call (list price) | Input tokens |
| --- | --- | --- | --- |
| `--model haiku` only (3 runs) | 3.86 s, 3.52 s, 4.09 s | not printed in text mode | not printed |
| `--model haiku --output-format json` | 4.22 s | $0.00039 | 38,292 cache-read |
| Trimmed flags (all flags above except schema and effort) | 1.89 s, 1.78 s | about $0.000015 to $0.00014 | 643 cache-read, or 635 cache-write on a cold cache |
| Trimmed, `--effort low` | 1.77 s | $0.00014 | 635 cache-write |
| Trimmed, `--json-schema` for `{name}` with a kebab pattern | 1.89 s | $0.00026 | 1,144 cache-write |

What these show:

- Default `claude -p` loads George's whole Claude Code context. That is about 38,000 input tokens for a one-line task. Trimming cuts it to about 650 tokens and halves the wall time.
- The API portion of a trimmed call was about 0.7 to 0.85 s (`duration_api_ms`). The rest is process startup.
- Output was valid every time: `bench-sqlite-duckdb-csv`, `sqlite-vs-duckdb-csv`, `sqlite-duckdb-csv-bench`.
- `--json-schema` returned `{"name":"sqlite-duckdb-csv-bench"}` in `structured_output`. It adds output tokens, so it costs slightly more. It also guarantees the shape. Sprout still has to sanitize the slug itself. The docs say the schema `format` keyword is not enforced.
- Thinking tokens were 0 on these short prompts.

### Does it cost money?

- On a subscription, `claude -p` draws from the plan's usage limits. Anthropic's support page says, as of the June 15, 2026 update, that `claude -p` usage "still draw[s] from your subscription limits". It also says the previously announced changes are paused ([support article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)).
- The same page has an October 7, 2026 update. It says Max and Team plans now include monthly API credits that cover `claude -p`. I did not confirm how those credits interact with plan limits. Check that page before relying on either rule.
- If `ANTHROPIC_API_KEY` is set, `claude -p` always uses the key, not the subscription ([authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)). Then each call bills per token.
- A call this small uses a tiny share of a plan. I did not measure the plan percentage.

### Failure modes (tested)

| Condition | How I tested | Result |
| --- | --- | --- |
| Signed out | `CLAUDE_CONFIG_DIR` pointing at an empty directory | Prints `Not logged in · Please run /login` on stdout. Exit code 1. About 0.5 s. |
| Offline, default retries | `HTTPS_PROXY=http://127.0.0.1:1` (dead proxy) | Printed `API Error: Connection refused ... (ECONNREFUSED)`, exit code 1, after **175 s**. |
| Offline, `CLAUDE_CODE_MAX_RETRIES=0` | Same dead proxy | Same error, exit code 1, 0.9 s. |
| Offline, `CLAUDE_CODE_MAX_RETRIES=1 API_TIMEOUT_MS=5000` | Same dead proxy | Same error, exit code 1, 1.5 s. |

The 175-second hang matches the documented default of 10 retries ([env vars](https://code.claude.com/docs/en/env-vars)). A real offline machine may fail differently from a dead local proxy, for example with a DNS error or a timeout. I did not test a true network outage. Sprout can set `CLAUDE_CODE_MAX_RETRIES` for the child process to fail fast.

Errors go to stdout as plain text, not as JSON. A caller must check the exit code. The docs say a failure inside the run, such as missing authentication, prints "as the result on stdout" ([headless docs](https://code.claude.com/docs/en/headless#basic-usage)).

### Works for other users later?

- Only for users who have Claude Code installed and signed in. That is a heavy dependency for a small naming feature.
- Users on Bedrock, Vertex, or Foundry may get older models. The `haiku` alias maps to Haiku 4.5 there ([model config](https://code.claude.com/docs/en/model-config)).
- The CLI flags change often. This test used version 2.1.296. Several flags need recent versions, so pin or detect the version.
- A user's own settings, hooks, and skills affect a default call. Trimming flags remove most of that.

## Option B: Direct Anthropic Messages API

### Setup

- Create an API key in the [Claude Console](https://platform.claude.com/settings/keys).
- Put it in `ANTHROPIC_API_KEY`, or in Sprout's own config.
- Send `POST https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json` ([API overview](https://platform.claude.com/docs/en/api/overview#authentication)). Official SDKs exist for seven languages.
- Needs a funded Console account. Billing errors come back as HTTP 402 `billing_error` ([errors](https://platform.claude.com/docs/en/api/errors)).

### Model and price

- Current cheapest model: Claude Haiku 5.5, id `claude-haiku-5-5`, released October 7, 2026. Docs rate its latency "Fastest" ([models overview](https://platform.claude.com/docs/en/about-claude/models/overview)).
- Price for prompts up to 100,000 tokens: **$0.10 per million input tokens and $0.50 per million output tokens** ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)).
- The previous Haiku, 4.5, costs $1 and $5. Haiku 5.5 is ten times cheaper.
- Haiku 5.5 uses a newer tokenizer. The same text counts as about 30% more tokens than on Haiku 4.5 ([Haiku 5.5 overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview)).
- The Batch API gives 50% off, but it is asynchronous. It does not fit an interactive CLI.

### Cost estimate for one call

Assume 100 input tokens and 20 output tokens.

- Input: 100 / 1,000,000 x $0.10 = $0.00001
- Output: 20 / 1,000,000 x $0.50 = $0.00001
- Total: about **$0.00002 per call**, or roughly 50,000 calls per dollar.

Two cautions:

- Haiku 5.5 uses adaptive thinking by default. Thinking tokens bill as output. The Haiku 5.5 docs say it accepts `thinking: {"type": "disabled"}` ([errors page](https://platform.claude.com/docs/en/api/errors#thinking-cannot-be-disabled)). Disabling it keeps output near 20 tokens. I did not test this.
- A system prompt of 200 tokens adds only $0.00002. The cost stays in the range of $0.00004 per call.

### Latency

I did not measure this. No API key was available. As an inference, the `duration_api_ms` of 0.7 to 0.85 s in Option A is a good guide. That figure covers one Haiku 5.5 call. A direct call skips the roughly 1 s of Claude Code startup. Expect about 1 s or less.

### Output shape

- The API supports structured output through `output_config.format` ([errors page, "Prefill not supported"](https://platform.claude.com/docs/en/api/errors#prefill-not-supported)). Prefilling the reply is not supported on Claude 4.6 and later.
- Plain text with a strict prompt also worked well in Option A.

### Failure modes (from docs, not tested)

| Condition | Result |
| --- | --- |
| No key, or bad key | HTTP 401 `authentication_error`. |
| No credit or payment problem | HTTP 402 `billing_error`. |
| Rate limit or spend cap | HTTP 429 `rate_limit_error`. |
| Overloaded | HTTP 529 `overloaded_error`. |
| Offline | Connection error from the HTTP client. |

Official SDKs retry transient errors twice by default with backoff ([errors](https://platform.claude.com/docs/en/api/errors)). Offline failure should come in seconds, not minutes. The retry count and timeout are under the caller's control.

### Works for other users later?

- Yes, for anyone willing to make an API key and add credit.
- It needs no other software. It works from any language.
- The cost is real money, though tiny. Setup is more work than "already signed in".

## Option C: other options, briefly

- **Local model through Ollama.** Ollama is installed on this machine at `/opt/homebrew/bin/ollama`. Its models here are `clef` (18 GB) and `clef-flash` (12 GB). I did not run them. A local call costs no money. It works offline. But it needs a large model download, uses a lot of memory, and its first call loads the model. A small model might name well enough, but I did not test that. Source: `ollama list`.
- **`llm` CLI.** Not installed here (`which llm` found nothing). It would add a dependency without removing the need for a key or a local model.
- **No LLM.** Sprout could slugify the description itself. That needs no network and costs nothing. It does not meet the "LLM suggests a name" goal. It could serve as a fallback when the LLM call fails.

## Comparison

| | `claude -p`, default flags | `claude -p`, trimmed flags | Messages API, Haiku 5.5 | Local model (Ollama) |
| --- | --- | --- | --- | --- |
| Setup | Claude Code installed and signed in | Same | API key and funded Console account | Install Ollama, pull a model |
| Typical latency | 3.5 to 4.2 s (measured) | 1.8 to 1.9 s (measured) | About 1 s or less (inferred, not measured) | Not measured |
| Cost per call | About $0.0004 list price, but billed to plan limits | $0.00002 to $0.0003 list price, billed to plan limits | About $0.00002 (docs) | None |
| Counts against | Subscription limits (or API key if set) | Same | Pay per token | Local compute |
| Signed out | `Not logged in`, exit 1, 0.5 s (measured) | Same | HTTP 401 (docs) | Not applicable |
| Offline | 175 s hang, then exit 1 (measured with dead proxy) | 1 to 2 s with `CLAUDE_CODE_MAX_RETRIES` set (measured) | Fast connection error (docs) | Works |
| Works for other users | Only if they use Claude Code | Same | Yes, with a key | Yes, with a model |

## Implications for sprout

Trade-offs, not a decision:

- **Zero setup for George versus setup for everyone else.** `claude -p` needs nothing new for George today. The API route needs a key but has no other dependency. Sprout could support both and pick by what is available.
- **Trim the flags if `claude -p` is used.** Default flags doubled latency and multiplied input tokens by about 60 on this machine. The trimmed form is a long flag list tied to the Claude Code version.
- **Set a retry limit for offline use.** Without it, `claude -p` can hang for minutes. The experiment is only worth creating if naming does not block it.
- **Failure policy needs its own decision.** The naming call can fail by being signed out, offline, rate-limited, or out of credit. Sprout could fall back to a slug from the description, or prompt for a name.
- **Output must be validated either way.** Models may return extra words, capitals, or spaces. A JSON schema helps with shape but does not enforce a slug pattern in Claude Code. Sprout should sanitize and check for existing directory names.
- **Billing differs.** `claude -p` uses plan limits, and the rules are in flux (paused changes, new monthly credits). The API bills per token at about $0.00002 per call. Both costs are negligible at personal scale.
- **Publishing later.** `claude -p` ties Sprout to Claude Code. The API ties it to a key. A local model ties it to a download. A published tool may want the LLM to be optional.
- **Model freshness.** Haiku 5.5 launched three days before this research. The `haiku` alias will move to newer models. A pinned id like `claude-haiku-5-5` stays stable until retirement (not sooner than October 7, 2027, per the models overview).
- **Open items I did not measure.** True API latency, a real network outage, Ollama timing, and the plan-usage percentage of a `claude -p` call.

## Sources

- Headless docs: https://code.claude.com/docs/en/headless
- Authentication: https://code.claude.com/docs/en/authentication
- Model config (alias table): https://code.claude.com/docs/en/model-config
- Environment variables: https://code.claude.com/docs/en/env-vars
- Costs: https://code.claude.com/docs/en/costs
- Support, Agent SDK with your plan: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- API pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- Haiku 5.5 overview: https://platform.claude.com/docs/en/models/haiku-5-5/overview
- API overview: https://platform.claude.com/docs/en/api/overview
- API errors: https://platform.claude.com/docs/en/api/errors
- Local commands: `claude --help`, `claude --version`, `ollama list`, and the timed `claude -p` runs described above.
