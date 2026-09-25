# dsh-thinking-effort-setting

English | [中文](./README.zh.md)

Gives models imported through a [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) custom provider two things the catalog already has: the official thinking-depth menu, and the input types the model actually accepts. The composer keeps DSH's own menu. Thinking depth matches built-in DeepSeek: **Off**, **Low**, **High**, and **Max**.

This plugin was written with the help of AI.

## The problem it fixes

A built-in provider's models inherit reasoning levels from the installed catalog, so the composer shows an Effort row. A model you type in, or one added with "Fetch available models", has no `reasoningEfforts`. That row never appears, and the endpoint's own default decides whether the model thinks.

An older map that only lists `off`, `high`, and `max` has the same gap. DSH treats a level that was never declared as unsupported, so Low is missing from the menu.

Those models usually have no `input` either. DSH then treats them as text-only. Attaching an image shows “当前模型不支持图片，请切换支持图片的模型”, and the request does not send the image.

This plugin writes the missing official levels, and image input when it can tell, into your own settings. The stock composer then draws Effort, and uses `input` to decide whether an image can be attached. The plugin does not replace the composer, and it does not add a slider.

## Thinking depth

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

- `reasoningEfforts: false`, which explicitly turns reasoning off. Image detection is separate: a vision model that opts out of reasoning still receives `input`.
- A `reasoning` or `thinkingFormat` value that is already set.
- `modelOverrides` on a built-in catalog. Writing levels there would replace the catalog's own thinking map. `/input` changes input types only, not those levels.
- A model that exists only in a lower settings layer and has no entry in your own layer. A models array is replaced as a whole, so copying that entry in would drop the lower layer's name, input modalities, and compat settings.

## Image input

`input` on a custom model is chosen in this order:

1. A non-empty `input` you already wrote stays. `input: [text]` still turns images off. A value written by `/input` counts.
2. When the provider's model list discloses input types (for example `architecture.input_modalities` or `modalities.input`), that disclosure is used. A list that says text-only is not rewritten to image just because the id looks like Flash.
3. When the list says nothing, the published DeepSeek split applies. V4.1 Flash accepts images. That covers `deepseek-flash`, `deepseek-v4.1-flash`, and the legacy ids `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp`, which now alias the same model. V4 Pro does not accept images and stays text-only. A model this plugin cannot classify gets no `input` write, so a guess is not stored into the session.

Once the stored value is `[text, image]`, the composer allows an image and the request sends it.

### `/input`

The composer command changes only the selected model and stores the result. Later automatic detection does not change a value this command wrote.

```text
/input image true
/input image false
```

| Command | Effect |
| --- | --- |
| `/input image true` | Adds image input. A model with no declaration becomes `text` and `image`. |
| `/input image false` | Removes image input and leaves text. |
| `/input text true` | Adds text. |
| `/input text false` | Removes text. This fails when text is the only input left. |

A custom provider is saved as that model's `input` under `llm-pi-ai`. Built-in DeepSeek is saved as that model's `inputModalities` under `llm-deepseek`. Turning images off there also removes `imagePixelBudget` and `imageMaxBytes` on that model. On success the composer confirms the current inputs, for example: `zhongy/deepseek-v4.1-flash 已开启图片输入，并已写入配置。当前输入：text、image。`

If the model is not in the saved list, the command does not create a whole catalog. That would replace the lower layer. Add the model in Settings first.

## Install

Requires Node.js `^22.19.0` or `>=24`, and DSH `>=0.1.0-rc.7`. Install with the official `dsh plugin` command. Do not edit the profile `package.json` by hand.

No manual build is required. From any directory:

```bash
dsh plugin --profile web add github:MoRo-1337/dsh-thinking-effort-setting
```

The install fetches the repository and builds it for you. Restart DSH. Open a custom-provider model: the composer model button shows the current level, and Effort offers Off, Low, High, and Max. Type `/input` to turn image or text input on or off for the selected model.

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

Levels and input types already written stay in settings. They are often in the `llm-pi-ai` section of `$DSH_HOME/settings.yaml`. When settings are stored in the profile's `cordis.patch.yml`, they are in that file's matching section. To drop them, delete `reasoningEfforts` and `input` on the model. For a built-in DeepSeek model, delete `inputModalities`. The route's `reasoning: high`, when this plugin added it, can be deleted too.

## Build it yourself

Use this when you are changing the plugin, or when you want to install a local checkout instead of GitHub.

```bash
npm install
npm run build
dsh plugin --profile web add ./dsh-thinking-effort-setting
```

Run the `add` from the directory that contains this checkout, or pass the checkout's absolute path. `npm run build` writes `lib/index.js`, which is the file DSH loads. Restart DSH after installing.

`npm test` runs the level-fill, image-input, `/input` command, and settings-watcher tests.

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

If image input was declared and the endpoint still rejects the image, turn it off with `/input image false`, or set that model's `input` to `[text]`.

## License

[MIT](./LICENSE)
