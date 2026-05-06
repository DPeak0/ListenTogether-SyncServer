# ListenTogether-SyncServer

`ListenTogether-SyncServer` 是 ListenTogether 的自建 WebSocket 同步服务端。

GitHub 仓库地址：

- `https://github.com/DPeak0/ListenTogether-SyncServer`

## 交互式 Docker 一键部署脚本

- 容器内部监听端口固定为 `8787`
- 安装脚本会直接创建并启动 Docker 容器，不依赖 `docker compose`
- 如果检测到同名旧容器，脚本会提示是否删除后重新部署
- 服务端使用方法：按脚本部署后，在设置页面填写：服务端IP和端口`
