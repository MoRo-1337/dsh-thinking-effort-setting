# dsh-thinking-effort-setting

[English](./README.md) | 中文

给 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) 里通过「自定义提供方」导入的模型补上两件事：官方思考深度，以及模型实际接受的输入类型。作曲栏继续使用 DSH 自带的菜单。思考深度与内置 DeepSeek 一致：**Off**、**Low**、**High**、**Max**。

此插件借助了 AI 编写。

## 它解决什么问题

内置提供方的模型从已安装目录带有推理等级，作曲栏会显示「推理等级」。自定义提供方里手工录入或「获取可用模型」写入的模型没有 `reasoningEfforts`，这一行不会出现，模型是否思考由端点自己的默认值决定。

只写了 `off`、`high`、`max` 的旧配置也一样：DSH 把没有声明的等级当成不支持，菜单里就没有 Low。

这些模型通常也没有 `input`。DSH 于是把它们当成纯文本。附上图片时，作曲栏提示「当前模型不支持图片，请切换支持图片的模型」，请求也不会把图片发给模型。

本插件把缺少的官方档位，以及已经能判断的图片输入，写进你自己的设置。写好之后，官方作曲栏自己画出「推理等级」，并按 `input` 决定能不能添加图片。插件不替换作曲栏，也不另做滑块。

## 思考深度

对手写模型列表里还缺档位的条目，补上下表中缺少的键。已经写过的线上值保留，例如 `high: ultra` 不会被改成 `high`。

| 菜单 | 发给网关的 `reasoning_effort` |
| --- | --- |
| Off | 不发送该字段 |
| Low | `low` |
| High | `high` |
| Max | `max` |

另外两条只在还没人写过时才落笔：

- 路由还没有 `reasoning`，并且这条路由上每个手写模型都支持 High 时，默认档位写成 `high`。菜单里不会多出一行 Default，新会话从 High 开始。
- 模型 id 或名称里带 `deepseek`，协议是 `openai-completions`，且还没有 `thinkingFormat` 时，写上 `compat.thinkingFormat: deepseek`。这样 Off 会发送 `thinking: {type: disabled}`，而不是让默认会思考的端点继续思考。

下面这些保持原样：

- `reasoningEfforts: false`，这是明确关闭推理。图片判断与此无关：关掉推理的视觉模型仍会写上 `input`。
- 已经写过的 `reasoning` 和 `thinkingFormat`。
- 内置目录的 `modelOverrides`。在那里补档位会盖掉目录自己的思考映射。`/input` 只改输入类型，不改这里的思考档位。
- 只存在于更低配置层、用户层没有对应条目的模型。模型数组会整段替换，把这种条目抄进用户文档会丢掉下层的名称、输入模态和兼容设置。

## 图片输入

自定义模型的 `input` 按这个顺序决定：

1. 你已经写过的非空 `input` 保持原样。`input: [text]` 仍然关闭图片。`/input` 写过的值也算。
2. 提供方的模型列表如果公布了输入类型（例如 `architecture.input_modalities` 或 `modalities.input`），用公布的结果。列表明确是纯文本时，不会因为模型 id 像 Flash 就改成图片。
3. 列表没有公布时，按 DeepSeek 已公开的能力判断。V4.1 Flash 接受图片，包括 `deepseek-flash`、`deepseek-v4.1-flash`，以及现在指向同一模型的 `deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp`。V4 Pro 不接受图片，保持纯文本。认不出的模型不写 `input`，避免把一次猜测存进会话。

判断结果是 `[text, image]` 时，作曲栏允许添加图片，请求也会把图片发给模型。

### `/input`

作曲栏指令只改当前选中的模型，并把结果写入配置。自动判断之后不会再改这条指令写过的值。

```text
/input image true
/input image false
```

| 指令 | 效果 |
| --- | --- |
| `/input image true` | 在现有输入上加上图片。还没声明过输入的模型写成 `text`、`image`。 |
| `/input image false` | 去掉图片，留下文本。 |
| `/input text true` | 加上文本。 |
| `/input text false` | 去掉文本。至少保留一种输入，只剩文本时这条会失败。 |

自定义提供方写在 `llm-pi-ai` 里该模型的 `input`。内置 DeepSeek 写在 `llm-deepseek` 里该模型的 `inputModalities`；关掉图片时，会一并去掉该模型上的 `imagePixelBudget` 和 `imageMaxBytes`。成功时作曲栏会确认当前输入，例如：`zhongy/deepseek-v4.1-flash 已开启图片输入，并已写入配置。当前输入：text、image。`

模型不在已保存的列表里时，指令不会新建整份目录，避免盖掉下层配置。请先在设置里添加该模型。

## 安装

需要 Node.js `^22.19.0` 或 `>=24`，以及 DSH `>=0.1.0-rc.7`。请用官方 `dsh plugin` 安装，不要手工改 profile 的 `package.json`。

不需要自行构建。在任意目录执行：

```bash
dsh plugin --profile web add github:MoRo-1337/dsh-thinking-effort-setting
```

安装时会拉取仓库并自动构建。重启 DSH。打开自定义提供方里的模型，作曲栏模型按钮上会出现当前档位；点开「推理等级」即可选择 Off、Low、High、Max。输入 `/input` 可以开关当前模型的图片和文本。

profile 不叫 `web` 时，把命令里的 `web` 换成实际名称。

### `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

pnpm 10 及以后会拒绝 git 依赖在安装时的构建，直到这份依赖被明确允许。第一次 `add` 可能停在 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`。报错里的标识符和布尔值是这次安装生成的，只从你自己的终端里抄。不要沿用别人日志里的键或布尔值：键里面的提交每次安装都可能不同，布尔值也不总是同一个。

1. 用记事本或 VS Code 打开该 profile 的 `pnpm-workspace.yaml`。`web` profile 在 Windows 上是 `%USERPROFILE%\.dsh\profiles\web\pnpm-workspace.yaml`；设置了 `DSH_HOME` 时则是 `$DSH_HOME/profiles/web/pnpm-workspace.yaml`。别的 profile 用那个 profile 自己的目录。

2. 找到 `allowBuilds` 段，没有就自己加上。在它下面写入报错给出的那串完整标识符，值用报错给出的布尔值。这是 YAML 布尔值，按报错里的写法填写，不要加引号。文件里已经有 `allowBuilds:` 时，在它下面追加一行。`allowBuilds` 的值如果是空的或者 `false`，改成上面的映射。形式如下：

```yaml
allowBuilds:
  "<报错里的完整标识符>": <报错里的布尔值>
```

3. 保存文件，回到终端，重新执行原来的命令：

```bash
dsh plugin --profile web add github:MoRo-1337/dsh-thinking-effort-setting
```

这一允许会在安装时于你的机器上运行本包的代码。若希望以后的推送不会悄悄改变这次安装，可以钉住提交：`github:MoRo-1337/dsh-thinking-effort-setting#<sha>`。

升级：

```bash
dsh plugin --profile web update dsh-thinking-effort-setting
```

升级后重启 DSH。

卸载：

```bash
dsh plugin --profile web remove dsh-thinking-effort-setting
```

已经写入的档位和输入类型会留在设置里。常见位置是 `$DSH_HOME/settings.yaml` 的 `llm-pi-ai` 段；设置写进 profile 的 `cordis.patch.yml` 时，也在对应段里。不需要这些值时，删掉模型上的 `reasoningEfforts` 和 `input`。内置 DeepSeek 模型删的是 `inputModalities`。路由上由本插件写上的 `reasoning: high` 也可以一并删掉。

## 自行构建

改插件本身，或者想安装本地目录而不是 GitHub 时，用这一节。

```bash
npm install
npm run build
dsh plugin --profile web add ./dsh-thinking-effort-setting
```

在本目录的上一级执行 `add`，或把 `./dsh-thinking-effort-setting` 换成这份检出的绝对路径。`npm run build` 会生成 `lib/index.js`，这是 DSH 加载的文件。安装后重启 DSH。

`npm test` 跑档位补齐、图片输入判断、`/input` 指令和设置监听的测试。

## 网关仍然拒绝请求时

菜单只说明 DSH 会按所选档位发送思考深度。有的 OpenAI 兼容网关会拒绝这份请求形状：推理模型的系统提示词可能以 `developer` 角色发出，输出上限也可能写在 `max_completion_tokens`。在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里给该路由补上这两项，然后新开一个会话：

```yaml
- id: llm-pi-ai
  config:
    providers:
      my-gateway:
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
```

`my-gateway` 换成自定义提供方的路由 id。profile 不是 `web` 时，改用那个 profile 的目录。

声明了图片、但端点实际不接受图片时，提供方会在请求里拒绝。把该模型改回 `/input image false`，或在设置里把 `input` 写成 `[text]`。

## 许可

[MIT](./LICENSE)
