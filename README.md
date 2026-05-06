# ListenTogether-SyncServer

`ListenTogether-SyncServer` 是 ListenTogether 的自建 WebSocket 同步服务端，面向国内网络环境下的小规模好友房。

GitHub 仓库地址：

- `https://github.com/DPeak0/ListenTogether-SyncServer`

## 本地开发

```powershell
npm ci
npm test
npm run build
docker compose up --build
```

默认本地入口：

- `ws://127.0.0.1:8787/ws`

## 交互式 Docker 一键部署

仓库内提供了交互式安装脚本：

```bash
bash install.sh
```

脚本会引导你填写：

- Docker 容器名
- Docker 镜像地址
- 宿主机绑定地址
- 宿主机映射端口
- 房间 TTL、心跳超时、限流等运行参数

注意：

- 容器内部监听端口固定为 `8787`
- 你自定义的是“宿主机映射端口”，不是说容器内部端口会直接暴露到公网
- 默认绑定 `127.0.0.1`，更适合后续交给 Nginx 做 `/ws` 反代

脚本会生成：

- `docker-compose.generated.yml`

然后自动执行：

- `docker compose pull`
- `docker compose up -d`

## 镜像构建与来源

当前镜像由阿里云容器镜像服务自动构建，已配置为跟随 GitHub 仓库变更自动触发构建。

源代码仓库：

- `https://github.com/DPeak0/ListenTogether-SyncServer`

阿里云镜像地址：

- `crpi-euihr92xl17baj83.cn-shenzhen.personal.cr.aliyuncs.com/dpeak/listentogether-syncserver`

默认安装脚本会优先使用：

- `crpi-euihr92xl17baj83.cn-shenzhen.personal.cr.aliyuncs.com/dpeak/listentogether-syncserver:latest`
