# Jira Sprint Analysis

独立的 Tampermonkey（油猴）脚本，按 Sprint 对比日或周的任务状态快照。自动读取当前 Jira 页面的查询条件，获取该查询的全部分页，不固定绑定任何筛选器。

## 安装和使用

1. 浏览器安装 Tampermonkey 扩展。
2. [点击安装脚本](https://raw.githubusercontent.com/taomorrow/jira-sprint-analysis/main/jira-sprint-analysis.user.js)，在油猴安装页确认安装。若浏览器只显示源码，可在油猴新建脚本，粘贴本仓库 `.user.js` 文件全文并保存。
3. 登录 Jira，打开需要统计的问题列表页面，刷新后点击右下角 **Sprint Analysis**。
4. 点击 **载入当前页面（全部分页）**，勾选一个或多个 Sprint；状态默认全部，也可取消“全部状态”后勾选 IN PROGRESS、SIT 等状态，再点击 **开始分析**。
5. 修改 Sprint 或状态勾选后，旧结果和导出会失效，点击 **开始分析** 重新计算。
6. 确认右下角入口和面板版本为 **v0.1.5**。若仍是旧版，可从对应 Release 下载 `.user.js` 安装更新并刷新 Jira；同一页面新版会替换旧面板。
7. 点击状态数量查看对应任务；点击“查看变化”查看两时点状态不同或今日新建的任务；支持导出带 UTF-8 BOM 的 CSV。

脚本仅匹配配置的 Jira 域名，不依赖其他 Jira 脚本，不修改任务，日常分析不需要填写 Token，不向 GitHub 上传 Jira 数据。仅在用户配置 Teams 并在预览中确认推送后，才向该 Workflows 地址发送报告。自动更新由油猴管理器根据脚本头部的 GitHub 地址检查。

## Teams 配置、预览与推送

1. 更新安装 v0.1.5，接受油猴所需的菜单、脚本存储及微软 Workflows 域名跨域请求权限，再刷新 Jira。
2. 在 Teams 的目标频道/聊天创建 Workflows，例如“收到 Webhook 请求时发布卡片”，复制生成的 URL。使用接收 Adaptive Card 的模板，工作流须能处理 `type: message` 与 `attachments[].content`；自定义工作流需把附件 content 传给发布卡片步骤。
3. 从 **油猴菜单 → Teams 配置**，或分析面板里的 **Teams 配置**，填写目标名称和 Webhook URL，保存。配置不会发起联网测试，也不会立即推送。
4. 完成分析后点击 **预览并推送到 Teams**，核对目标名称、主机和完整报告内容，再点击 **确认推送**。取消预览不会发送。
5. HTTP 2xx 只表示 Webhook 接受请求，实际投递需在 Teams 或 Workflows 运行记录确认。超时、网络失败可能出现结果未知，不自动重试；请先检查 Teams，避免重复发布。

发送内容为当前报告快照：所选 Sprint / 状态、日周维度与日期范围、状态数量 / 合计 / 环比、净变化数量、新建数量、JQL 和 Jira 查询链接。不会发送逐条任务标题、负责人或完整变更历史。预览为完整文本内容，实际 Teams 使用 Adaptive Card 排版。

- Webhook URL 仅使用 `GM_setValue` 保存在当前油猴脚本存储，不放入源码或 GitHub。配置中支持清除；预览只显示主机，不显示签名密钥。不要把自己的 Webhook 提交为 issue 或发到公开聊天。
- 支持微软 `*.logic.azure.com`、`*.api.powerplatform.com`、`*.api.powerautomate.com` Workflows HTTPS 地址，不支持旧版 Office Connector URL、任意第三方代理或自定义中转域名。
- 当前仅支持凭 Webhook URL 调用的触发器；**不支持要求 Microsoft OAuth/Bearer Token 的租户认证触发器**。若公司策略要求认证，需由管理员提供合规的认证接入方案，脚本不会复用 Jira Cookie 或绕过租户认证。
- 单条报告超过 26 KiB 会阻止发送并提示减少所选 Sprint，不会静默删减内容。发送不带 Cookie，不跟随重定向，不做自动重试，确认按钮防重复点击。
- 本地模拟验证了配置保存、预览/取消不发送、确认单次 POST、卡片格式和超时处理；**未使用真实 Webhook 投递测试**。

参考：[Microsoft Teams Workflows 文档](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)、[Tampermonkey API](https://www.tampermonkey.net/documentation.php?locale=en)。

## Sprint 和状态选择

- Sprint 使用复选框，无需按 Ctrl / ⌘；支持全选与清空。默认勾选活动 Sprint，没有活动 Sprint 时勾选第一项。
- 全部分页用于发现候选任务，随后只为所选 Sprint 匹配任务读取历史并生成报表。面板区分页面总条数、Sprint 匹配数和所选状态涉及的去重任务数。
- 状态固定为 Completed、DEPLOYED、Grooming、In Progress、New、Open、Ready For Deploy、Ready For Test、Ready For UAT、SIT、Testing、UAT，不再请求全站状态目录或增加其他选项。名称匹配忽略大小写及多余空格，同名不同 ID 的状态合并统计。
- 默认“全部指定状态”包含上述 12 个；具体状态框为空，直接勾选即进入指定状态模式。勾选“全部”清除具体选择并恢复 12 个状态范围。指定状态即使两个时点都是 0，也会显示零值行；其他状态不进入表格、合计或 CSV。
- 状态筛选分别应用于昨日和今日快照，表格和 CSV 的“所选状态合计”只汇总选定状态。例如只选 IN PROGRESS，某任务昨日为 IN PROGRESS、今日为 Done，则昨日计 1、今日计 0；变化明细保留完整流向。
- 修改选择后需重新分析，避免把旧结果误认为新的选择结果。

## By day / By week

在“对比维度”选择，默认 By day；切换后重新点击“开始分析”。表格、明细和 CSV 的日期说明与表头同步变化。

- **By day**：昨日日终与今天截至查询开始时的状态数量对比，显示日环比。
- **By week**：每周周一 00:00 至周日结束，以**上周日终**与**本周截至当前**的状态数量对比，显示周环比。举例：2026-10-30 查询时，范围为上周 10-19～10-25、本周 10-26～11-01；基准快照为 10-26 00:00 之前，本期为查询开始时。
- 本周尚未结束，因此明确标为“截至当前，未满周”。这是状态快照数量比较，不是整周累计流转次数，也不是每天数量之和。
- 周一 00:00 的变更属于本周，全部计算使用上海时区。当前成员回溯的限制仍适用于周对比。

## 统计口径（请先阅读）

- **时区固定 Asia/Shanghai，UTC+08:00**，与浏览器、Jira 个人时区无关。
- 昨日：今天 00:00 之前的最后状态；恰好午夜的变更计入今天。
- 今日：查询开始时刻的状态，使用完整变更历史逆向回算。昨日尚未创建的任务不计入昨日。
- **以当前查询成员回溯状态**，不还原昨天的筛选器成员、负责人、Resolution 或 Sprint 成员。
- 以当前页面 JQL 为范围，保留页面搜索条件，自动获取所有分页。例如页面排除已解决任务时，完成数量不能代表整个 Sprint。
- 当前页面 Advanced 编辑器的 JQL 优先，其次 URL 的 `jql` 参数。仅当页面没有 JQL、只有 `filter` 参数时，解析该页面筛选器的 JQL；不会固定套用 180929。任务详情页则仅统计当前任务。无法识别查询时提示，不擅自扩大范围。
- 修改查询后先在 Jira 点击 Search，再重新载入。分析时查询改变会提示重新载入。
- Jira Sprint 字段可能保留已关闭 Sprint；每个返回的 Sprint 关联分别计数。同一 issue 可以出现在多个 Sprint，**不要跨 Sprint 直接相加**。
- 增减 = 今日 − 昨日；日环比 = 增减 / 昨日 × 100%。昨日 0、今日大于 0 显示“新增”；两天都是 0 显示“—”。状态减少本身不表示变好或变坏。
- “变化明细”展示两个时点的净状态变化和新建任务；同一天从 A 到 B 又回 A 的任务不列入净变化。不统计移入/移出 Sprint、完成流转次数或重新打开次数。
- 只统计当前账号有权访问的任务。被删除、当前不可见、已从当前筛选结果移出的任务无法包含在昨日回溯中。
- REST 读取不是数据库事务快照。脚本检查分页重复及分页总数变化；每次分析重新读取任务详情，不以搜索索引与详情的 updated 字符串差异推断真实修改，仍无法排除查询期间所有并发修改，必要时刷新重算。

## 实现与兼容性

面向 Jira Server / Data Center REST API v2：

- `/rest/api/2/field` 自动识别 Sprint 字段（`com.pyxis.greenhopper.jira:gh-sprint`）。
- `/rest/api/2/search` 分页获取筛选器/所选 Sprint 的全部可见任务，不依赖页面是否只显示第一页。
- `/rest/api/2/issue/{key}?expand=changelog` 获取完整状态历史，最多 3 路并发。
- 如果展开的历史被截断，尝试 `/rest/api/2/issue/{key}/changelog` 分页；服务器不支持或历史完整性无法确认时，停止并提示，不生成部分报表。
- 接口 401/403、非 JSON 登录页、30 秒超时均有明确提示。
- 每次分析重新读取任务详情及历史；只在页面内存保留本次结果，不使用 localStorage/IndexedDB 保存任务数据。
- CSV 单元格进行公式注入防护；任务名称通过 textContent 显示。

## 验证状态

已通过 18 项本地自动化测试（DOM 模拟及模拟 REST，不代表真实 Jira 联调）：午夜边界、多次流转回溯、新建任务、现代/旧式 Sprint 格式、多 Sprint 关联、空 Sprint、零分母、CSV 转义、当前页面 JQL 优先级、搜索分页、重复分析刷新历史、updated 时间格式差异、历史截断分页和失败阻断、UI 明细文本安全、Sprint 勾选隔离与历史请求范围、状态过滤与跨状态流出合计、默认全部直接勾选状态、198 条四页数据组合筛选及实际 CSV 内容、旧面板替换、浏览器 module 全局兼容、固定状态范围、日/周切换及周一/周日与跨年边界、Teams URL 校验、菜单配置保存不发送、预览取消不发送、确认单次 POST 与超时不重试。

**尚未在目标 Jira 的登录会话中联调**：开发环境访问目标页面时返回登录页。首次使用需验证该实例的 API 权限与 changelog 完整性；如果报错，请反馈面板提示及 HTTP 状态码，不必提供密码、Cookie 或 Token。

## 开发

```sh
npm ci --ignore-scripts
npm test
npm run check
```

本地界面预览（仅模拟数据）：在仓库根目录运行 `python3 -m http.server 8766`，访问 `http://localhost:8766/test/preview.html`。

`jira-sprint-analysis.user.js` 为完整单文件产物，无需构建；npm 依赖仅用于本地测试，不会加载到 Jira 页面。

## 后续方向

历史 Sprint 成员快照、状态合并配置、每日趋势、流转事件统计可作为后续版本扩展。本版没有后台定时任务，浏览器关闭后不会持续采集。
