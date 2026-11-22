# 开发交接

接手顺序：README → DATA_SOURCES → 本文 → `git status -sb` → 核对本地文件与端口。忽略目录可能因机器而异。不要假设已下载或生成的数据随 Git 同步。

## 目标和约束

以历史年代为坐标浏览作品与地图。数据应能离线读取、可追溯并保留原始标识。疆界有效期、地点记载、地名和历史身份各自有语义。资料缺失应保留空值或仅搜索。不同来源的同名、近邻地点不自动合并。

## 已完成

- 作品库、自由缩放故事时间轴、Markdown 笔记和图片、批量导出。
- 自由年份地图、分级自然地理底图、政权搜索和演变、固定年份对照图。
- Pleiades、WHG、CODH 和 Viabundus 地点导入。Node.js 使用本地索引，按年份和地图范围服务客户端。地点卡片分组显示史料和来源。
- 下线页面中的旧试点选编标签和独立来源条目，保留仍用于地图和搜索的逐点记录及出处。
- 数据数量、下载和导入状态见 [DATA_SOURCES](DATA_SOURCES.md)。最近核验共 123,199 条地点，39,263 条有年代依据，39,253 条与地图年份相交。
- V4 已接入 26 条独立历史事件。事件列表和地图共享当前年份、类别和关键词条件。事件图层开关只控制地图标记。邻近事件可从数字标记选择，详情支持打开来源及已关联的地点。

## 关键位置

- `server.mjs` 负责 HTTP、静态资源、作品和笔记；`atlas-place-index.mjs` 负责地点查询、详情和服务进程内索引缓存。
- `public/atlas/atlas.mjs` 控制时间和来源；`geography.mjs` 负责地图地点标签与卡片；`place-api.mjs` 负责本地请求去重与缓存。
- `public/atlas/events.json` 为事件数据；`event-data.mjs` 校验及筛选；`events.mjs` 管理列表、标记及详情。对照模式使用实际快照年份。地点关联沿用原有详情 API。
- `scripts/prepare-atlas.mjs` 生成背景、疆界、对照和地点索引；`scripts/import-places.mjs` 和 `import-place-data.mjs` 负责 Pleiades / LPF。
- `scripts/prepare-codh-poi.py` 与 `scripts/prepare-viabundus.py` 将外部 CSV 转为 LPF。
- `atlas-data/raw/` 原始文件，`atlas-data/place-packs/` 归一化来源包，`atlas-data/place-query-index.json` 服务查询索引。
- `atlas-encyclopedia.json` 为仓库中的核对快照，`atlas-polity-aliases.json` 为人工别名。
- `data/` 是用户资料，维护地图时避免修改。

## 尚未完成与下一步

1. V4 的事件维护目前通过人工编辑 JSON 和自动测试完成。事件编辑表单、批量导入和大规模事件库尚未实现。新增条目需校验时间、点位和出处。
2. 补 WHG 候选：未认证的接口请求返回 403。已登录网页仍会按数据集限制下载，例如 1911 年中国城镇。可联系发布者，或选用已获准独立发布的同源文件。不得用未经核实的坐标补齐缺失文件。
3. 复核 Viabundus 已入库节点的覆盖与地名年代，检查日本 CODH 行政地名变迁表的 ID 对齐。只有可追溯的时间依据能进入年份图层。
4. 继续检查重复：复用来源稳定 ID 和有出处的人工对应关系，保留冲突来源。核对性能后再考虑地理索引优化。

## 操作命令

```powershell
npm ci
npm run atlas:prepare
npm run atlas:places
npm test
npm start
```

- `atlas:prepare -- --with-comparison` 首次获取对照快照；`atlas:prepare -- --refresh-encyclopedia` 联网重建百科关联。
- 用 `npm run atlas:import-places -- lpf <文件> <元数据>` 导入 LPF。Pleiades 使用 `pleiades <官方 JSON 或 gzip>`。
- 数据变更后重启 Chronicle，进程会重新读取索引。先确认并停止旧 Chronicle 实例，再复用原端口。若用户正在用 4181，验证并尽量保留这个地址。
- 不记录凭据值、不提交 `.env` 或 `credentials/`。WHG 登录和许可步骤见数据源清单。
