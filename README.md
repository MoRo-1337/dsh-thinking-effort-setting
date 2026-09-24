# dsh-thinking-effort-setting

English | [中文](./README.zh.md)

Gives models imported through a [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) custom provider the official thinking-depth menu. The composer keeps DSH's own menu. The choices match built-in DeepSeek: **Off**, **Low**, **High**, and **Max**.

This plugin was written with the help of AI.

## The problem it fixes

A built-in provider's models inherit reasoning levels from the installed catalog, so the composer shows an Effort row. A model you type in, or one added with "Fetch available models", has no `reasoningEfforts`. That row never appears, and the endpoint's own default decides whether the model thinks.

An older map that only lists `off`, `high`, and `max` has the same gap. DSH treats a level that was never declared as unsupported, so Low is missing from the menu.

This plugin adds the missing official levels to your own `llm-pi-ai` settings. Once they are declared, the stock composer draws the menu:

1. Open the model button. The root menu has a Model row and an Effort row.
2. Open Effort. The list is Off, Low, High, and Max, with a check on the current level.

The plugin does not replace the composer, and it does not add a slider.

## What it writes

For each hand-declared model that is missing a level, it adds the missing keys from the table below. A wire spelling you already stored stays, so `high: ultra` is not rewritten to `high`.

| Menu | `reasoning_effort` sent to the gateway |
| --- | --- |
| Off | The field is omitted |
| Low | `low` |
| High | `high` |
| Max | `max` |

Two further writes happen only when nobody has set them yet:

- When the route has no `reasoning`, and every hand-declared model on it supports High, the default becomes `high`. The menu then has no extra Default row, and a new session starts on High.
- When the model id or name contains `deepseek`, the protocol is `openai-completions`, and `thinkingFormat` is still empty, the plugin sets `compat.thinkingFormat: deepseek`. Off then sends `thinking: {type: disabled}` instead of leaving a model that thinks by default still thinking.

These stay as they are:

- `reasoningEfforts: false`, which explicitly turns reasoning off.
- A `reasoning` or `thinkingFormat` value that is already set.
- `modelOverrides` on a built-in catalog. Writing levels there would replace the catalog's own thinking map.
- A model that exists only in a lower settings layer and has no entry in your own layer. A models array is replaced as a whole, so copying that entry in would drop the lower layer's name, input modalities, and compat settings.

## Install

Requires Node.js `^22.19.0` or `>=24`, and DSH `>=0.1.0-rc.7`. Install with the official `dsh plugin` command. Do not edit the profile `package.json` by hand.

No manual build is required. From any directory:

```bash
dsh plugin --profile web add github:MoRo-1337/dsh-thinking-effort-setting
```

The install fetches the repository and builds it for you. Restart DSH. Open a custom-provider model: the composer model button shows the current level, and Effort offers Off, Low, High, and Max.

pnpm 10 and later refuses a git dependency's install-time build until you allow it. If the first `add` stops and names this package, add the key it printed to the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-thinking-effort-setting: true
```

Then run the same `dsh plugin` command again. That allowance runs this package's code on your machine at install time. Pin a commit (`github:MoRo-1337/dsh-thinking-effort-setting#<sha>`) if you want later pushes to stay out of that install.

For a profile other than `web`, replace `web` in the command.

Upgrade:

```bash
dsh plugin --profile web update dsh-thinking-effort-setting
```

Restart DSH after the update.

Remove:

```bash
dsh plugin --profile web remove dsh-thinking-effort-setting
```

`reasoningEfforts` already written stays in that profile's `cordis.patch.yml`. To drop the levels, delete `reasoningEfforts` on the model and the `reasoning: high` this plugin added on the route.

## Build it yourself

Use this when you are changing the plugin, or when you want to install a local checkout instead of GitHub.

```bash
npm install
npm run build
dsh plugin --profile web add ./dsh-thinking-effort-setting
```

Run the `add` from the directory that contains this checkout, or pass the checkout's absolute path. `npm run build` writes `lib/index.js`, which is the file DSH loads. Restart DSH after installing.

`npm test` runs the level-fill and settings-watcher tests.

## When the gateway still rejects the request

The menu only means DSH sends the selected thinking depth. Some OpenAI-compatible gateways reject that request shape: a reasoning model's system prompt may go out as the `developer` role, and the output cap may be sent as `max_completion_tokens`. Add both switches on that route in `$DSH_HOME/profiles/web/cordis.patch.yml`, then start a new session:

```yaml
- id: llm-pi-ai
  config:
    providers:
      my-gateway:
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
```

Replace `my-gateway` with the custom provider's route id. For another profile, use that profile's directory instead of `web`.

## License

[MIT](./LICENSE)
