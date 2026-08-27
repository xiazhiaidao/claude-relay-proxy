# Claude Code 中转站代理

解决 Claude Code 2.1.246+ 与第三方中转站 API 的兼容性问题。

## 两种方案，按需选择

| | 方案 A：CC Switch 路由 | 方案 B：本地代理脚本 |
|--|----------------------|-------------------|
| 适合人群 | 使用 CC Switch 的用户 | 不用 CC Switch，直接配 Claude Code 的用户 |
| 需要安装 | CC Switch | Node.js |
| 操作门槛 | GUI 点两下 | 改文件 + 配环境变量 |
| 原理 | CC Switch 自动转换 API 格式 | 本地代理清理不兼容请求 |

> 💡 如果你已经在用 CC Switch，**优先选方案 A**，更简单。

---

## 方案 A：CC Switch 路由（推荐）

无需下载本仓库的任何文件，在 CC Switch 里操作即可。

### 步骤

1. 打开 CC Switch → 编辑供应商
2. 请求地址填中转站地址（如 `https://你的中转站地址`），不要填本地代理
3. 展开**高级选项** → API 格式改为 **OpenAI Chat Completions (需开启路由)**
4. 开启路由功能（CC Switch 会自动做 Anthropic ↔ OpenAI 格式转换）
5. 填入 API Key
6. 模型映射里填 `deepseek-v4-flash-0731`（带 -0731 后缀）
7. 保存，切换到该供应商
8. 重启 VS Code

> ⚠️ 模型名必须带 `-0731` 后缀，不带会报"模型不存在"。

### 原理

CC Switch 把 Claude Code 发出的 Anthropic Messages 格式自动转成 OpenAI Chat Completions 格式发给中转站，beta 头、system 消息、thinking 块等不兼容内容在格式转换中被自然消化，不需要额外清理。

---

## 方案 B：本地代理脚本

适合不用 CC Switch、直接配置 Claude Code 的用户。

### 问题

Claude Code 升级到 2.1.246 后新增了以下特性，导致第三方中转站返回 400/503 错误：

- `anthropic-beta` 请求头（interleaved-thinking 等）
- `messages` 数组中出现 `role: "system"` 消息
- 请求体含 `metadata`、`thinking`、`context_management`、`output_config` 等未知字段
- 消息内容含 `thinking` 类型的 content block
- 响应中使用 Brotli 压缩导致解压失败

### 解决方案

本地 Node.js 代理，自动清理不兼容内容后转发给中转站。

```
Claude Code → http://127.0.0.1:5678 (本地代理) → https://中转站地址
```

代理处理的 6 项兼容性修复：

| # | 问题 | 修复 |
|---|------|------|
| 1 | `anthropic-beta` 头 | 全部剥离 |
| 2 | `messages` 中 `system` 角色 | 迁移到 `system` 参数 |
| 3 | `metadata`/`thinking` 等未知字段 | 请求体清理 |
| 4 | 消息中的 `thinking` content block | 请求时剥离 |
| 5 | 响应中的 `thinking` 块 | SSE 流和 JSON 响应都剥离 |
| 6 | Brotli 压缩 | 禁用请求压缩 + 删除响应编码头 |

### 使用方法

#### 1. 安装 Node.js

如果没有 Node.js，去 [nodejs.org](https://nodejs.org) 下载安装 LTS 版本。

#### 2. 下载脚本

将 `relay-proxy.js` 和 `启动中转代理.bat` 放到 `C:\Users\你的用户名\.claude\` 目录下。

#### 3. 修改中转站地址

用记事本打开 `relay-proxy.js`，修改第 5 行：

```js
const RELAY_TARGET = 'https://你的中转站地址';
```

#### 4. 修改 Claude Code 配置

打开 `C:\Users\你的用户名\.claude\settings.json`，修改以下字段：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:5678",
    "ANTHROPIC_AUTH_TOKEN": "你的中转站API Key",
    "ANTHROPIC_MODEL": "deepseek-v4-flash-0731",
    "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT": "1"
  },
  "supports_reasoning": false
}
```

> ⚠️ 模型名必须带 `-0731` 后缀，不带会报"模型不存在"。

#### 5. 设置系统环境变量

Windows 搜索"环境变量" → 系统环境变量 → 新增：

| 变量名 | 值 |
|--------|-----|
| `ANTHROPIC_AUTH_TOKEN` | 你的中转站 API Key |
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:5678` |
| `ANTHROPIC_MODEL` | `deepseek-v4-flash-0731` |

#### 6. 启动代理

双击 `启动中转代理.bat`，看到以下输出说明成功：

```
[relay-proxy] listening on http://127.0.0.1:5678 -> https://你的中转站地址
[relay-proxy] warmup done (TLS connection established)
```

#### 7. 重启 VS Code

完全关闭 VS Code 后重新打开，发一条消息测试。

### CC Switch + 代理（不用路由功能）

如果用 CC Switch 但不想开启路由，也可以让 CC Switch 走本地代理：

- API 地址：`http://127.0.0.1:5678`
- API 格式：保持 **Anthropic Messages (原生)**
- API Key：你的中转站 Key
- 模型：`deepseek-v4-flash-0731`

### 开机自启（可选）

将 `启动中转代理.bat` 的快捷方式放入启动文件夹：

`Win+R` → 输入 `shell:startup` → 将快捷方式拖入

### 健康检查

代理运行后访问 `http://127.0.0.1:5678/health`，返回 JSON 状态即正常。

---

## 常见问题

**Q: 报 503 模型服务不可用？**
A: 中转站上游过载，等 10-30 分钟重试。

**Q: 报 400 模型不存在？**
A: 模型名写错了，确认是 `deepseek-v4-flash-0731`（带 -0731）。

**Q: 报 429 限流？**
A: 请求太频繁，等一会儿再试。

**Q: 报 400 当前模型不支持该能力：vision？**
A: 当前模型不支持图片识别。Claude Code 读取图片时会触发此错误，跳过图片步骤即可，不影响文本对话。

**Q: 方案 A 和方案 B 能同时用吗？**
A: 可以，但没必要。选一个就行。方案 A 更简单，方案 B 更可控。

**Q: 还是报 400？**
A: 确认代理在运行（看终端窗口有没有 `[relay-proxy] listening`），确认 `settings.json` 里 `ANTHROPIC_BASE_URL` 是 `http://127.0.0.1:5678`。或访问 `http://127.0.0.1:5678/health` 检查代理状态。
