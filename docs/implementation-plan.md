# StarScope Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 创建真实数据驱动的中文 GitHub Star 排名与监控站点。

**Architecture:** Node 标准库代理官方 GitHub API；JSON 原子保存榜单缓存、监控快照及收入披露。原生 ES modules 前端通过固定 API 契约消费数据。

**Tech Stack:** Node.js 22+、HTML、CSS、JavaScript、Node 内置测试。

**Spec:** docs/design.md

## Global Constraints

- 项目在 github-star-monitor/ 中独立实现，运行依赖为零；不修改兄弟项目。
- 只监听 127.0.0.1，默认 4320；GITHUB_TOKEN 不进入前端或数据文件。
- 排行按 Star 排序；缺失历史增长为 null；收入有来源、币种和周期，不混排。
- 界面以中文为主；清晰展示数据来源、采集时间与缓存状态。

## Review Focus

- GitHub 限流/网络失败且已有缓存：保留旧数据并标示过期。
- 同仓库大小写及 URL 输入：归一化并避免重复监控。
- 监控首次采集：不能显示编造增长；刷新失败不清空历史。
- 收入非法日期/不同币种周期：拒绝无效数据并隔离排名。
- 外部文本、CSV 与链接：不能执行脚本、公式或发起跨站写入。

### Task 1: 官方数据接口、持久化与后台采集

**Files:** server.mjs, lib/github.mjs, lib/store.mjs, test/server.test.mjs, test/github.test.mjs, test/store.test.mjs。

**Interfaces:** 产出 design.md 中全部 HTTP API 和 Repo/Revenue 字段，前端按其消费。

- [x] 先写真实可观察行为测试并运行，确认缺少实现时失败。
- [x] 实现校验、GitHub 请求与缓存、JSON 原子保存、监控历史和收入记录。
- [x] 完成 HTTP 路由、静态文件限制、Origin 校验、每小时刷新和默认端口。
- [x] 运行全部后端测试，确认通过并记录结果。

### Task 2: 中文排行与监控界面

**Files:** public/index.html, public/styles.css, public/app.mjs, public/core.mjs, public/favicon.svg, test/core.test.mjs。

**Interfaces:** 消费 Task 1 的 JSON API。core.mjs 提供 CSV、安全链接、排序与收入分组逻辑。

- [x] 先测试搜索/收入排序/CSV 输出与未知增长行为，运行确认失败。
- [x] 实现响应式页面、搜索筛选、四个视图、详情、添加监控及收入表单。
- [x] 实现刷新、错误/加载/空状态、来源时间和 CSV 导出。
- [x] 运行测试并完成桌面与手机浏览器验证。

### Task 3: 集成与交付

**Files:** README.md, docs/verification.md。

- [x] 实际请求本地服务及 GitHub 官方 API，验证首屏和各操作数据。
- [x] 独立审查整个项目，修复实质问题并运行相关回归验证。
- [x] 写明运行方式、数据口径、限流和后台采集边界；打开本地站点。
