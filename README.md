# Jira Sprint Analysis

独立的 Tampermonkey（油猴）脚本，按 Sprint 对比昨日日终与今日截至查询时的任务状态。默认入口为用户指定的 Jira 筛选器 **180929**。

## 安装和使用

1. 浏览器安装 Tampermonkey 扩展。
2. [点击安装脚本](https://raw.githubusercontent.com/taomorrow/jira-sprint-analysis/main/jira-sprint-analysis.user.js)，在油猴安装页确认安装。若浏览器只显示源码，可在油猴新建脚本，粘贴本仓库 `.user.js` 文件全文并保存。
3. 登录 Jira，打开筛选器页面，刷新后点击右下角 **Sprint Analysis**。
4. 点击 **载入 Sprint**，选择一个或多个分组，点击 **开始分析**。
5. 点击状态数量查看对应任务；点击“查看变化”查看两时点状态不同或今日新建的任务；支持导出带 UTF-8 BOM 的 CSV。

脚本仅匹配配置的 Jira 域名，不依赖其他 Jira 脚本，不修改任务，不需要填写 Token，也不向 GitHub 或第三方服务上传 Jira 数据。自动更新由油猴管理器根据脚本头部的 GitHub 地址检查。

## 统计口径（请先阅读）

- **时区固定 Asia/Shanghai，UTC+08:00**，与浏览器、Jira 个人时区无关。
- 昨日：今天 00:00 之前的最后状态；恰好午夜的变更计入今天。
- 今日：查询开始时刻的状态，使用完整变更历史逆向回算。昨日尚未创建的任务不计入昨日。
- **以当前查询成员回溯状态**，不还原昨天的筛选器成员、负责人、Resolution 或 Sprint 成员。
- 默认范围为 `filter = 180929` 的当前结果，保留筛选器全部限制。例如它排除已解决任务时，完成数量不能代表整个 Sprint。
- “所选 Sprint 全部可见任务”使用 `sprint in (...)`，去掉筛选器的其他限制。Sprint 选项仍由筛选器结果发现。未分配 Sprint 分组仅支持筛选器范围。
- Jira Sprint 字段可能保留已关闭 Sprint；每个返回的 Sprint 关联分别计数。同一 issue 可以出现在多个 Sprint，**不要跨 Sprint 直接相加**。
- 增减 = 今日 − 昨日；日环比 = 增减 / 昨日 × 100%。昨日 0、今日大于 0 显示“新增”；两天都是 0 显示“—”。状态减少本身不表示变好或变坏。
- “变化明细”展示两个时点的净状态变化和新建任务；同一天从 A 到 B 又回 A 的任务不列入净变化。不统计移入/移出 Sprint、完成流转次数或重新打开次数。
- 只统计当前账号有权访问的任务。被删除、当前不可见、已从当前筛选结果移出的任务无法包含在昨日回溯中。
- REST 读取不是数据库事务快照。脚本检查分页重复、分页总数变化、任务读取期间 updated 变化；仍无法排除查询期间所有并发修改，必要时刷新重算。

## 实现与兼容性

面向 Jira Server / Data Center REST API v2：

- `/rest/api/2/field` 自动识别 Sprint 字段（`com.pyxis.greenhopper.jira:gh-sprint`）。
- `/rest/api/2/search` 分页获取筛选器/所选 Sprint 的全部可见任务，不依赖页面是否只显示第一页。
- `/rest/api/2/issue/{key}?expand=changelog` 获取完整状态历史，最多 3 路并发。
- 如果展开的历史被截断，尝试 `/rest/api/2/issue/{key}/changelog` 分页；服务器不支持或历史完整性无法确认时，停止并提示，不生成部分报表。
- 接口 401/403、非 JSON 登录页、30 秒超时均有明确提示。
- 历史缓存在当前页面内存中，以 issue key + updated 复用；刷新页面即清空，不使用 localStorage/IndexedDB 保存任务数据。
- CSV 单元格进行公式注入防护；任务名称通过 textContent 显示。

## 验证状态

已通过本地自动化测试：午夜边界、多次流转回溯、新建任务、现代/旧式 Sprint 格式、多 Sprint 关联、空 Sprint、零分母、CSV 转义、搜索分页、历史缓存、历史截断分页和失败阻断、UI 明细文本安全。

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
