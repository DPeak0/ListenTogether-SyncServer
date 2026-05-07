# ListenTogether-SyncServer

`ListenTogether-SyncServer` 是 ListenTogether 的自建 WebSocket 同步服务端。

GitHub 仓库地址：

- `https://github.com/DPeak0/ListenTogether-SyncServer`

## 交互式 Docker 一键部署脚本

- 容器内部监听端口固定为 `8787`
- 安装脚本会直接创建并启动 Docker 容器，不依赖 `docker compose`
- 普通用户执行时，安装脚本会自动使用 `sudo docker ...`
- 如果检测到同名旧容器，脚本会提示是否删除后重新部署
- 服务端使用方法：按脚本部署后，在扩展设置页填写 `服务端地址`
- 支持直接填写 `服务器IP:端口`、`域名:端口`、`ws://...` 或 `https://...`
- 服务端默认兼容根路径 `/` 和旧路径 `/ws`，无需手动追加路径
