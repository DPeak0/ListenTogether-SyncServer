# ListenTogether-SyncServer

`ListenTogether-SyncServer` 是 ListenTogether 的自建 WebSocket 同步服务端，面向国内网络环境下的小规模好友房。

## 本地开发

```powershell
npm ci
npm test
npm run build
docker compose up --build
```

默认监听地址：

- `ws://127.0.0.1:8787/ws`

## Docker 镜像

独立仓库推送到 `main` 或打 `v*` 标签后，会通过 GitHub Actions 自动构建并发布 GHCR 镜像。

由于 Docker / OCI 镜像名必须使用小写，镜像地址使用：

- `ghcr.io/dpeak0/listentogether-syncserver`
