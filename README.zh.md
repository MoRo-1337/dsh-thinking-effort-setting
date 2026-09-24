# dsh-thinking-effort-setting

[English](./README.md) | 中文

给 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) 里通过「自定义提供方」导入的模型补上官方思考深度。作曲栏继续使用 DSH 自带的菜单，选项与内置 DeepSeek 一致：**Off**、**Low**、**High**、**Max**。

此插件借助了 AI 编写。

## 它解决什么问题

内置提供方的模型从已安装目录带有推理等级，作曲栏会显示「推理等级」。自定义提供方里手工录入或「获取可用模型」写入的模型没有 `reasoningEfforts`，这一行不会出现，模型是否思考由端点自己的默认值决定。

只写了 `off`、`high`、`max` 的旧配置也一样：DSH 把没有声明的等级当成不支持，菜单里就没有 Low。

本插件在用户自己的 `llm-pi-ai` 配置里补上缺少的官方档位。档位写好之后，官方作曲栏自己画出菜单：

1. 点开模型按钮，根菜单是「模型」和「推理等级」。
2. 点开「推理等级」，列表为 Off、Low、High、Max，当前档位打勾。

插件不替换作曲栏，也不另做滑块。

## 它会写入什么

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

- `reasoningEfforts: false`，这是明确关闭推理。
- 已经写过的 `reasoning` 和 `thinkingFormat`。
- 内置目录的 `modelOverrides`。在那里补档位会盖掉目录自己的思考映射。
- 只存在于更低配置层、用户层没有对应条目的模型。模型数组会整段替换，把这种条目抄进用户文档会丢掉下层的名称、输入模态和兼容设置。

## 安装

需要 Node.js `^22.19.0` 或 `>=24`，以及 DSH `>=0.1.0-rc.7`。请用官方 `dsh plugin` 安装，不要手工改 profile 的 `package.json`。

不需要自行构建。在任意目录执行：

```bash
dsh plugin --profile web add github:MoRo-1337/dsh-thinking-effort-setting
```

安装时会拉取仓库并自动构建。重启 DSH。打开自定义提供方里的模型，作曲栏模型按钮上会出现当前档位；点开「推理等级」即可选择 Off、Low、High、Max。

pnpm 10 及以后会拒绝执行 git 依赖在安装时的构建，直到你明确允许。如果第一次 `add` 停住并点名了这个包，把终端里打印的包名写入该 profile 的 `pnpm-workspace.yaml`：

```yaml
allowBuilds:
  dsh-thinking-effort-setting: true
```

然后再执行一次上面的 `dsh plugin` 命令。这一允许会在安装时于你的机器上运行本包的代码。若希望以后的推送不会悄悄改变这次安装，可以钉住提交：`github:MoRo-1337/dsh-thinking-effort-setting#<sha>`。

profile 不叫 `web` 时，把命令里的 `web` 换成实际名称。

升级：

```bash
dsh plugin --profile web update dsh-thinking-effort-setting
```

升级后重启 DSH。

卸载：

```bash
dsh plugin --profile web remove dsh-thinking-effort-setting
```

已经写入的 `reasoningEfforts` 会留在该 profile 的 `cordis.patch.yml` 里。不需要这些档位时，删掉对应模型上的 `reasoningEfforts`，以及路由上由本插件写上的 `reasoning: high`。

## 自行构建

改插件本身，或者想安装本地目录而不是 GitHub 时，用这一节。

```bash
npm install
npm run build
dsh plugin --profile web add ./dsh-thinking-effort-setting
```

在本目录的上一级执行 `add`，或把 `./dsh-thinking-effort-setting` 换成这份检出的绝对路径。`npm run build` 会生成 `lib/index.js`，这是 DSH 加载的文件。安装后重启 DSH。

`npm test` 跑档位补齐和设置监听的测试。

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

## 许可

[MIT](./LICENSE)
