# AGENTS.md

## GitHub 推送

已配置 git credential helper，直接 `git push origin master` 即可，无需在 URL 中嵌入 token。

Token 存储在 `.github-credentials.json`（已 gitignore），格式：
```json
{ "user": "xiazhiaidao", "token": "github_pat_...", "repo": "claude-relay-proxy" }
```

Token 过期时间：2026-09-03，过期后需重新生成。

## 项目结构

- `relay-proxy.js` — 代理脚本核心
- `启动中转代理.bat` — Windows 启动批处理
- `README.md` — 用户使用说明
- `.github-credentials.json` — 凭证文件（不入库）

## 更新流程

1. 修改 `relay-proxy.js`
2. 同步更新 `README.md`（如有新功能）
3. `git add` + `git commit` + `git push origin master`
4. 更新 release zip：`Compress-Archive -Path relay-proxy.js,启动中转代理.bat,README.md -DestinationPath ../claude-relay-proxy.zip -Force`
