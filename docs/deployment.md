# 公网部署

StarScope 使用 Docker Compose 与服务器现有 Nginx，部署在独立域名的根路径 `/`。公网配置启用只读模式：可以查询榜单、搜索、查看监控和导出数据；新增、删除、手动刷新和收入录入请求返回 `403 READ_ONLY`。浏览器管理操作应使用单独的本地工作空间。

## 部署目标与调查状态

- 线上入口：[https://github.coinexo.top/](https://github.coinexo.top/)
- DNS A 记录源站值：`43.108.37.222`，由域名所有者配置
- SSH 主机别名：`api.stonehome.online`，实际为 `root@43.108.37.222:22`
- 应用目录：`/opt/github-star-monitor`
- 当前版本链接：`/opt/github-star-monitor/current`
- 版本目录：`/opt/github-star-monitor/releases/<版本号>`
- 持久化状态：`/opt/github-star-monitor/state/state.json`
- Compose 项目：`starscope`，只发布 `127.0.0.1:4320`
- Nginx 配置：`/etc/nginx/conf.d/github.coinexo.top.conf`
- 证书客户端：Certbot 2.9.0，Nginx 插件；现有 `certbot.timer` 已启用

### 当前版本：2026-10-15 · 1.3.0

2026-10-15 08:34（上海时间）升级至 **1.3.0**，`current` 指向 `/opt/github-star-monitor/releases/20261015-1.3.0`。资产摘要为 `e3a4ee7afc04`，压缩包 SHA-256 为 `9c6b060ae23d8e611b8809bf36a555b1071607466ea52f54dd889500d34cce5f`。

启动时检查总榜和新晋榜的缓存，此后每 15 分钟在后台检查并按共享缓存有效期更新。浏览器在可见时每 60 秒同步，回到前台或恢复联网时立即同步；监控仍每小时采集。失败保留旧数据和原采集时间，按 GitHub 限流响应及网络退避规则等待重试。无 Token，不承诺上游故障时仍能准时取得新数据。

私有备份为 `/opt/github-star-monitor/backups/state-before-20261015-1.3.0.json`。部署后逐项核对：20 个监控身份和 generation、1,340 个原有快照及全部披露记录保留，披露仍为 0，状态格式未变化。08:34:29–30 两榜均完成真实采集，每榜返回 50 项；总榜有 GitHub `incompleteResults` 标记，保留在接口与页面中。20 个监控实际采集于 08:30:27–29，错误列表为空；升级没有伪造新监控快照。

本次只替换应用。三个 Nginx 配置摘要、XScope 容器身份均未变化，两个容器健康；XScope 源站 HTTPS 和原 IP HTTP 返回 200。StarScope 公网及源站 HTTPS 校验成功，HTTP 301 保留查询参数，Certbot 定时器 active/enabled，没有重新签发证书。app、CSS 和新增 controller 的实际 HTTP SHA-256 均与本地正式包一致。

实际上一版本为 `/opt/github-star-monitor/releases/support-persistent-20261013-bda5309364-02`，保留作为首选回滚目标；不是下面历史记录中的 10 月 12 日版本。应用回滚继续使用当前共享状态，不恢复旧状态备份。公开导航及详情/错误状态继续提供“支持项目”入口。

### 历史发布：2026-10-12 · 1.2.0

2026-10-12 17:09（上海时间）升级至 **1.2.0**，当时发布目录为 `/opt/github-star-monitor/releases/20261012-1.2.0`。商业价值页新增保守、基准、积极三档月收入场景测算，真实披露保留在独立标签中。发布资产摘要为 `1041455d7454`，源站 HTTP 返回的脚本与样式 SHA-256 均与本地正式包一致。

升级前在私有目录保存完整状态备份 `/opt/github-star-monitor/backups/state-before-20261012-1.2.0.json`。升级后逐项核对：20 个监控的身份与 generation 不变，100 个原有历史快照全部保留，真实披露记录仍为 0。状态格式未变化，未迁移或覆盖共享状态。容器健康，版本 1.2.0、只读模式、初始化告警为空；5 种公网管理写入均返回 `403 READ_ONLY`。Nginx 配置 SHA-256 未变化，原 XScope 容器身份未变化且健康，XScope 源站 HTTPS 返回 200。

17:11 的公网与指定源站 IP HTTPS 检查均通过证书校验；HTTP 301 保留 `/?v=1.2.0` 路径与查询参数。真实浏览器确认商业页 50 个真实 GitHub 项目、参数即时重算、真实披露空态和 20 个监控。109 项自动测试通过，正式包完成 1440/390/375px 布局及极值金额、CSV、币种、非法参数保护、存储不可用和原页面回归检查。

初次 1.1.0 部署目录为 `/opt/github-star-monitor/releases/20261012-1.1.0`，该版本保留供回滚。当天 12:23（上海时间）公共 DNS 尚为 `NXDOMAIN`；13:01 用户映射后已查询到 Cloudflare 的 A 与 AAAA 代理地址，普通域名请求到达 StarScope。13:02 签发并安装 Let's Encrypt 证书，公网及指定源站 IP 的 HTTPS 均通过证书校验并返回 HTTP 200，HTTP 301 重定向保留原路径与查询参数。

源站证书到期时间为 **2027-01-10 12:03:49（上海时间）**。13:05 的 `certbot renew --cert-name github.coinexo.top --dry-run` 演练成功，`certbot.timer` 为 active/enabled，当次检查显示下一次运行时间为 2026-10-12 15:11:50（上海时间）。演练后 Nginx 配置检查、公网状态接口、原 XScope HTTPS 与两个容器健康状态再次通过。线上真实浏览器确认 50 个榜单项目、20 个公开监控及版本 1.1.0 正常展示。

验收确认：版本 `1.1.0`、公开只读、未配置 Token、初始化告警为空、50 个真实榜单项目及 20 个真实监控快照。5 种管理写入请求均返回 `403 READ_ONLY`；首次增长保持未知。线上带摘要的应用脚本与本地发布包 SHA-256 一致。原 XScope 的 IP HTTP 返回 200，域名 HTTP 保持重定向，源站 HTTPS 返回 200，两个容器均健康。全套 85 项测试通过，发布包在实际浏览器中完成参数校验、排序、详情、CSV、独立收入页及 1440/390/375px 布局检查。

服务器已有 `xscope.coinexo.top`，其应用使用 `127.0.0.1:4310`、Compose 项目 `xscope` 和独立 Nginx 文件。StarScope 的操作必须使用自己的项目名、目录、端口和配置文件；不要覆盖现有站点或 Nginx 默认站点。原 IP HTTP 入口仍属于 xscope。

## 运行配置

镜像固定为已验证的 Node.js 22 Alpine 摘要，不需要安装第三方包。容器以 UID/GID 1000 运行，上限为 256MiB 内存、0.5 CPU、64 个进程；重启策略为 `unless-stopped`。根文件系统只读，仅 `/app/data` 绑定目录和 `/tmp` 可写。

Compose 固定 `PUBLIC_MODE=1`、`PUBLIC_HOSTS=github.coinexo.top`、`BOOTSTRAP_MONITORS=20`，并保持 `GITHUB_TOKEN` 为空。首次使用空状态目录时，服务查询真实 Star 总榜，尝试为前 20 个项目采集当前快照；已有监控不会在升级或重启时被替换。启动期间可能等待上游请求，因此健康检查给出 120 秒启动宽限。采集失败会保留可用结果，并通过 `/api/status` 的 `bootstrapWarning` 说明。

后台每小时更新已有监控；未达到初始化目标时会重试本轮失败的项目。重启后根据当时榜单补足剩余位置，保留已有监控身份与历史，不替换完整列表，不超过配置数量。日、周、月增长需要积累对应时间的真实基线，首次启动不会生成历史增长数据或预置收入。监控、历史、榜单缓存和收入保存在共享状态目录中，版本更新与回滚均继续使用它。

无 Token 的 GitHub 常规接口通常只有每小时 60 次额度，搜索另有限额，实际以 GitHub 响应为准。站点缓存榜单并在上游失败时保留旧数据；公开请求不能强制绕过榜单缓存。仓库详情有 15 分钟缓存、并发去重及每小时 20 次未缓存读取的共享预算；后台监控采集使用独立通路。Nginx 对每个 IP 的全部 `/api/` 请求合计限制为每分钟约 30 次、突发 10 次，并限制并发连接；这些限制不能保证 GitHub 上游额度永不耗尽。接入 Token 前应另行设计访问认证和额度控制。

## 首次启动与更新

在本地运行 `npm run build` 生成部署产物，将压缩包上传到服务器 `/tmp/`，并解压到新的版本目录。以下命令在服务器上以 root 执行；`release` 和压缩包路径须替换为本次实际值，解压后版本目录应直接包含 `Dockerfile`、`compose.yaml`、`server.mjs`、`lib/` 和 `public/`：

```sh
release="20261015-<版本号>"
install -d -m 755 "/opt/github-star-monitor/releases/$release"
tar -xzf "/tmp/starscope-$release.tar.gz" -C "/opt/github-star-monitor/releases/$release"
install -d -o 1000 -g 1000 -m 700 /opt/github-star-monitor/state
cd "/opt/github-star-monitor/releases/$release"
STARSCOPE_RELEASE="$release" STARSCOPE_STATE_DIR=/opt/github-star-monitor/state \
  docker compose -p starscope config --quiet
STARSCOPE_RELEASE="$release" STARSCOPE_STATE_DIR=/opt/github-star-monitor/state \
  docker compose -p starscope up --build -d --wait --wait-timeout 180
ln -sfn "/opt/github-star-monitor/releases/$release" /opt/github-star-monitor/current
```

先确认容器健康，再更新 `current` 链接。状态目录必须先创建为 UID/GID 1000 所有；否则 Docker 自动创建的 root 目录会导致只读容器无法保存数据。不要把本地 `data/` 打入镜像或覆盖服务器已有 `state.json`。

首次安装 Nginx 配置：

```sh
install -d -m 755 /var/www/letsencrypt/.well-known/acme-challenge
install -m 644 deploy/nginx.conf.template /etc/nginx/conf.d/github.coinexo.top.conf
nginx -t
systemctl reload nginx
curl -fsS --resolve github.coinexo.top:80:43.108.37.222 \
  http://github.coinexo.top/api/status
```

仅在目标文件尚不存在时执行模板安装；已由 Certbot 管理的配置不能在应用更新时用 HTTP 模板覆盖。模板首部的限流 zone 指令需要在 Nginx 的 `http` 上下文加载；Ubuntu 默认的 `/etc/nginx/conf.d/*.conf` 已处于该上下文。zone 名称使用 `starscope_` 前缀，避免与其他站点冲突。`/.well-known/acme-challenge/` 使用独立验证目录，不经过应用代理或 API 限流。

静态响应采用 `Cache-Control: no-cache`，API 响应由应用设置 `no-store`；请求体上限 16KiB，代理超时 30 秒。Cloudflare 开启代理时，源站默认看到的是 Cloudflare 的 IP，限流可能合并多个访客。若需要按访客限流，应配置只信任当前 Cloudflare 官方网段的 real IP 规则，再验证 `$remote_addr`；不要直接信任任意来源的转发头。

当前 Cloudflare 注入的 Web Analytics beacon 会被应用的 `script-src 'self'` 策略阻止；此项不影响榜单或 API，应用保持原有 CSP，没有为第三方统计脚本放宽权限。Cloudflare 的具体 SSL 模式未通过账户 API 检查；源站已有可信证书，应使用 Full (strict)。

## 检查与回滚

```sh
cd /opt/github-star-monitor/current
STARSCOPE_STATE_DIR=/opt/github-star-monitor/state docker compose -p starscope ps
curl -fsS http://127.0.0.1:4320/api/status
curl -fsS --resolve github.coinexo.top:80:43.108.37.222 \
  http://github.coinexo.top/api/monitors
docker logs --tail 50 starscope-app-1
```

状态接口应返回 `version: "1.3.0"`、`readOnly: true` 和 `tokenConfigured: false`，以及 `rankingRefreshMinutes: 15`、`clientRefreshSeconds: 60`、`refreshMinutes: 60`。健康检查仅确认 HTTP 服务可用，还需要核对 `monitorCount`、`bootstrapWarning`、两榜实际采集时间、监控实际采集时间与后续刷新错误。首次采集成功时预计有 20 个监控；上游额度或网络失败时数量可能较少。不要把容器健康等同于全部数据采集成功。

可以使用以下写入检查确认公开站点拒绝管理操作；应返回 HTTP 403 和 `READ_ONLY`，不会新增监控：

```sh
curl -sS -i --resolve github.coinexo.top:443:43.108.37.222 \
  -H 'Content-Type: application/json' \
  --data '{"fullName":"nodejs/node"}' \
  https://github.coinexo.top/api/monitors
```

回滚时选择保留的旧版本，用相同状态目录重新启动 Compose，再更新版本链接：

```sh
release="<旧版本号>"
cd "/opt/github-star-monitor/releases/$release"
STARSCOPE_RELEASE="$release" STARSCOPE_STATE_DIR=/opt/github-star-monitor/state \
  docker compose -p starscope up -d --wait --wait-timeout 180
ln -sfn "/opt/github-star-monitor/releases/$release" /opt/github-star-monitor/current
curl -fsS http://127.0.0.1:4320/api/status
```

回滚应用不回滚状态。跨状态格式升级前，先停止 StarScope、备份整个共享状态目录，再启动新版本；需要恢复状态时也应先停止容器。不要让两个服务进程同时写入同一个状态目录，不要删除仍需回滚的镜像或版本目录。`/api/export` 返回的是可读导出，不是可直接替换 `state.json` 的同结构备份。

## 域名与 HTTPS

在 DNS 服务商中为 `github.coinexo.top` 设置 A 记录，源站为 `43.108.37.222`。若设置 AAAA，必须确认对应 IPv6 源站可达；不要保留错误的 AAAA 记录。Cloudflare 开启代理时，公共 DNS 返回 Cloudflare 地址是正常现象，后台源站 A 记录仍应指向上述 IP。

DNS 生效后，先验证普通域名 HTTP 请求到达 StarScope，再签发受信任证书：

```sh
dig +short github.coinexo.top A
dig +short github.coinexo.top AAAA
curl -fsS http://github.coinexo.top/api/status
certbot --nginx --cert-name github.coinexo.top --non-interactive --redirect \
  -d github.coinexo.top
nginx -t
systemctl reload nginx
curl -sSI http://github.coinexo.top/
curl -fsS https://github.coinexo.top/api/status
curl -fsS --resolve github.coinexo.top:443:43.108.37.222 \
  https://github.coinexo.top/api/status
```

Certbot 可复用服务器现有账户配置。DNS 未生效或 HTTP 验证路径不可达时，应先完成 HTTP 部署并保留待办，不能宣称证书已签发。不要创建伪自签证书，也不要通过关闭 TLS 校验来判断 HTTPS 成功。

HTTP 应重定向到同路径与查询参数的 HTTPS 地址；公网入口和指定源站 IP 的 HTTPS 检查均需通过证书校验。使用 Cloudflare 代理时，在源站证书验证成功后采用 **Full (strict)** 模式，并保持 HTTP-01 验证请求能够到达源站。

## 自动续期

证书签发、DNS 或代理配置调整后，核对定时器、证书和该域名的续期演练：

```sh
systemctl status certbot.timer --no-pager
systemctl list-timers certbot.timer --all
certbot certificates --cert-name github.coinexo.top
certbot renew --cert-name github.coinexo.top --dry-run
journalctl -u certbot.service --since "7 days ago" --no-pager
```

只有实际签发与检查成功后才能记录证书有效期、下一次续期检查和演练结果。续期后再次验证 HTTPS 状态接口；不要仅凭当前页面可访问就认定自动续期正常。
