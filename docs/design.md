# StarScope 设计

目标：在当前工作区创建一个可运行的中文 GitHub 项目监控站点，以真实 Star 排行为首页，辅助发现项目、持续记录增长和查看有来源的收入披露。

“收入”的含义尚未收到补充，首版采用项目收入披露榜；收入需手动录入金额、币种、周期、披露日期和来源链接，不按 Star 数推算收入。若用户指站点商业收入，可另行增加赞助位管理。

## 体验

桌面采用浅色数据产品风格：白色导航、深色标题、薄荷绿强调色、排行榜主内容与发现侧栏。手机单列，筛选、榜单、监控与详情都可操作。中文界面，技术名、仓库名保留原文。

主导航为 Star 排行、新晋项目、收入排行、我的监控。排行榜提供语言、主题分类与搜索，默认显示 GitHub 搜索 API 返回的前 50 个公开、未归档仓库，按 Star 降序；明确说明是当前搜索结果而非完整 GitHub 数据库。新晋项目指最近 30 天创建的仓库。项目详情展示官方指标、来源时间、监控状态与真实采集趋势。

监控列表持久化在服务端，服务运行时每小时尝试刷新。首个快照无历史增长；只有至少覆盖对应 1/7/30 天的基线才能产生增长值。新增、移除、手动刷新和 CSV 导出可用。最多监控 30 个项目，刷新失败保留已有数据并说明错误。

收入按币种和周期独立排序，绝不把月收入、年收入或不同币种直接混排。首版没有虚构收入或随机增长示例。

## 架构与接口

Node.js 22+ 标准库 HTTP 服务、原生 HTML/CSS/ES modules，无第三方运行依赖。新项目拥有自己的 Git 仓库，不修改兄弟项目。只监听 127.0.0.1:4320；可用 PORT 环境变量覆盖。GITHUB_TOKEN 只从服务端环境读取。data/ 中原子保存 JSON，文件不提交 Git。未配置 Token 也能尝试公开接口，遇到限流显示提示；榜单缓存 15 分钟并在上游失败时返回带 stale 标记的缓存。

Repo 字段：fullName, name, owner, description, url, stars, forks, language, topics, createdAt, updatedAt, pushedAt, archived, license, ownerAvatar。监控 item 额外携带 growth: {day, week, month}，未知值为 null。

所有 API 错误：{error:{code,message}}。

| 请求 | 返回 |
| --- | --- |
| GET /api/status | {tokenConfigured,refreshMinutes,monitorCount,lastRefreshAt,now} |
| GET /api/rankings?language=&topic=&q=&new=1&fresh=1 | {items:Repo[],meta:{source,fetchedAt,stale,totalCount,incompleteResults,scope}}；source 为 github-api 或 cache |
| GET /api/monitors | {items:RepoWithGrowth[],meta:{lastRefreshAt,refreshMinutes}} |
| POST /api/monitors {fullName} | {item:RepoWithGrowth} |
| DELETE /api/monitors?repo=owner/name | {ok:true} |
| POST /api/refresh | {items,errors,lastRefreshAt} |
| GET /api/repo?name=owner/name | {item:Repo,growth,history:[{at,stars,forks}]} |
| GET /api/revenues | {items:Revenue[]} |
| POST /api/revenues {repo,amount,currency,period,date,sourceUrl,notes} | {item:Revenue} |
| DELETE /api/revenues?id= | {ok:true} |
| GET /api/export | {version,exportedAt,monitors,revenues} |

Revenue 字段：id, repo, amount（正数）, currency（USD/CNY/EUR）, period（monthly/yearly/one-time）, date（真实 YYYY-MM-DD，非未来）, sourceUrl（https/http URL）, notes（可空）, createdAt。同仓库同币种同周期同日期重复录入应替换或拒绝，不累加。收入是来源声明，非审计验证。

## 验证

测试真实行为：GitHub 查询及输入约束、限流/超时/缓存降级、原子持久化与监控刷新、缺失历史增长、收入分组/校验、CSV 注入防护、静态访问限制和跨站写入拦截。浏览器验证搜索、语言筛选、监控持久化、详情、收入录入删除与移动端；再核对官方线上数据与页面展示。
