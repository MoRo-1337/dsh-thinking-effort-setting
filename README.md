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

For a profile other than `web`, replace `web` in the command.

### `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

pnpm 10 and later refuses a git dependency's install-time build until that exact dependency is allowed. The first `add` can stop with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`. The identifier and the boolean in that message are produced for your install. Copy them from your own terminal. Do not reuse a key or a boolean from someone else's log: the commit in the key changes between installs, and the boolean is not always the same.

1. Open the profile file `pnpm-workspace.yaml` in a text editor. For the `web` profile that is `%USERPROFILE%\.dsh\profiles\web\pnpm-workspace.yaml` on Windows, or `$DSH_HOME/profiles/web/pnpm-workspace.yaml` when `DSH_HOME` is set. Another profile uses that profile's directory.

2. Find the `allowBuilds` section. Add one if the file has none. Under it, add the full identifier the error printed, and set it to the boolean the error printed. The value is a YAML boolean: write it as the error shows it, with no quotes. If `allowBuilds:` is already there, append a line beneath it. If `allowBuilds` is empty or `false`, replace that value with the map. The shape is:

```yaml
allowBuilds:
  "<the full identifier from your error>": <the boolean from your error>
```

3. Save the file and run the original command again:

```bash
dsh plugin --profile web add github:MoRo-1337/dsh-thinking-effort-setting
```

That allowance runs this package's code on your machine at install time. Pin a commit (`github:MoRo-1337/dsh-thinking-effort-setting#<sha>`) if you want later pushes to stay out of that install.

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
