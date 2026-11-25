# 开发交接

接手顺序：README → DATA_SOURCES → 本文 → `git status -sb` → 核对本地文件与端口。忽略目录可能因机器而异。不要假设已下载或生成的数据随 Git 同步。

## 目标和约束

以历史年代为坐标浏览作品与地图。数据应能离线读取、可追溯并保留原始标识。疆界有效期、地点记载、地名和历史身份各自有语义。资料缺失应保留空值或仅搜索。不同来源的同名、近邻地点不自动合并。

## 已完成

- 作品库默认按体验日期排序，速览卡展示作品简介、简评和体验记录。作品库和故事时间轴共用作品数据；作品笔记从列表打开，支持正文、图片和导出。
- 自由年份地图、分级自然地理底图、政权搜索和演变、固定年份对照图。
- Pleiades、WHG、CODH 和 Viabundus 地点导入。Node.js 使用本地索引，按年份和地图范围服务客户端。地点卡片分组显示史料和来源。
- 下线页面中的旧试点选编标签和独立来源条目，保留仍用于地图和搜索的逐点记录及出处。
- 数据数量、下载和导入状态见 [DATA_SOURCES](DATA_SOURCES.md)。最近核验共 123,199 条地点，39,263 条有年代依据，39,253 条与地图年份相交。
- V4 默认保留 200 条精选，包括原有 26 条、35 条 Wikidata 人工复核事件、9 条 NOAA 地震样本及 130 条全球大事记。「全部事件」会请求 `/api/atlas/events?year=`，将当前年份的本机批量目录和精选合并，可按地区、类别和关键词浏览，每次显示 60 条。事件图层开关仅控制地图标记。邻近事件可从数字标记选择，详情支持打开来源及已关联的地点。
- 2026-11-23 快照覆盖 NOAA 34 页、EventKG 3.2 命名和文本分库，以及 Wikidata 120 个最终查询分片。全部范围均有逐条处理结果。11 月 24 日新增「仅看可上图」和主来源筛选，按 Wikidata 类型细分 26,675 条命名事件，并新增 10 条区域精选。现有 210 条精选、全库 1,381,960 条唯一事件、20,880 条可上图。28 项自动化测试通过。

## 关键位置

- `server.mjs` 负责 HTTP、静态资源和路由。作品库和故事时间轴由 `public/app.mjs` 驱动，年代计算在 `public/chronology.mjs`，体验日期规则在前后端共用的 `public/experience.mjs`。历史时空是独立的 `/atlas` 页面，地点和事件查询分别由 `atlas-place-index.mjs` 和 `atlas-event-catalog.mjs` 处理。
- `public/atlas/atlas.mjs` 控制时间和来源；`geography.mjs` 负责地图地点标签与卡片；`place-api.mjs` 负责本地请求去重与缓存。
- `public/atlas/events.json` 保留原始事件，另外加载 `events-wikidata.json`、`events-noaa.json`、`events-milestones.json`。`event-data.mjs` 校验及筛选，`events.mjs` 管理列表、标记及详情。`scripts/import-noaa-events.mjs` 将 HazEL JSON 按审定名单生成可离线分发的样本。对照模式使用实际快照年份，地点关联沿用原有详情 API。
- `scripts/prepare-atlas.mjs` 生成背景、疆界、对照和地点索引；`scripts/import-places.mjs` 和 `import-place-data.mjs` 负责 Pleiades / LPF。
- `scripts/prepare-codh-poi.py` 与 `scripts/prepare-viabundus.py` 将外部 CSV 转为 LPF。
- `atlas-data/raw/` 原始文件，`atlas-data/place-packs/` 归一化来源包，`atlas-data/place-query-index.json` 服务查询索引。
- `atlas-encyclopedia.json` 为仓库中的核对快照，`atlas-polity-aliases.json` 为人工别名。
- `data/` 是用户资料，维护地图时避免修改。

## 笔记模块与存储

| 位置 | 职责 |
| --- | --- |
| `public/note-dialog.mjs` | `createNoteDialog(dialog)` 接收现有对话框 DOM。通过标题、笔记 API 基址和保存回调打开笔记；管理预览、编辑、未保存提示、图片插入和下载。复用现有 `notes.css` 和对话框内的 `data-note-action` 控件。 |
| `public/notes.mjs`、`public/batch-notes.mjs` | 作品入口、作品标题、保存后更新 `notePath` 和按作品批量导出。 |
| `note-files.mjs` | Markdown 渲染和本地图片引用解析、图片类型检查和读写。渲染由调用方指定图片 API 前缀，原始 HTML 禁用，图片仅解析为当前笔记的本地资源。 |
| `note-storage.mjs`、`server.mjs` | 由作品 ID 定位笔记，核对作品关系和正文版本，组织单份与批量导出。作品 API 继续使用 `/api/works/:id/note`。 |
| `atomic-write.mjs` | 作品、笔记和地图导入工具共用的单文件原子替换。 |

`data/chronicle.json` 保存作品索引、体验信息与笔记路径，无索引时使用 `fixtures.json`。作品正文保存在 `data/works/work-<id>/note.md`，图片在同级 `assets/`，正文以相对 Markdown 链接引用。保存时用 SHA-256 正文版本防止旧编辑器覆盖新正文。备份和恢复应包含整个 `data/`，最好在无写入时进行。历史时空在 `atlas-data/` 使用独立的来源文件和生成索引，按数据源清单维护。

## 架构审计结论

- **前端继续使用原生 ES Modules。** 当前作品和地图已有页面边界，笔记复用只需要实例化对话框并提供 API 基址。等多个页面实际出现复杂的共享状态、组合式编辑或重复渲染逻辑，再以具体维护成本评估框架。
- **继续使用 JSON 索引、Markdown 正文和独立图片。** 当前以本地单用户运行，正文便于备份、直接读取和导出。先按实际笔记规模评估列表与搜索；出现文件扫描或整表写入瓶颈、明确需要全文索引或多条元数据事务时，再评估 SQLite。可先让 SQLite 承载可重建的索引；跨数据库和文件的原子性仍需单独设计。
- **作品整表保存存在并发覆盖窗口。** 服务端队列只串行化写入，无法识别较早读取的作品列表。笔记版本校验和服务端保留 `notePath` 已覆盖笔记正文与路径保护。多页面编辑成为常用流程时，可为作品写入加版本检查或改为逐条更新。
- **笔记索引、正文和图片有各自的写入时机。** 首次保存先写正文再写作品索引；进程在两次写入之间中断可留下未关联正文。放弃含新图片的草稿或删除作品也可能留下文件。以后增加检查或恢复路径时，先定义恢复规则和测试中断场景，再处理无引用文件。
- **ZIP 在内存中生成。** 当前沿用 128 MB 内容上限。大量图片的知识笔记有了可测量的导出需求之后，再考虑流式打包。

本轮回归通过 28 项自动化测试，包括笔记版本冲突、图片上传与读取、作品索引绑定和单份及批量导出。作品库列表提供查看或创建笔记的入口。

## V5 开发方向

V5 推进独立知识库。作品关联属于知识库，可通过现有作品 ID 建立关联。现有作品笔记继续通过作品 ID 和原有 API 访问。

知识笔记可用独立 ID、索引、目录和 API，并复用编辑对话框、Markdown 渲染及图片管理。先确定知识笔记的元数据、搜索和备份需求，再决定索引方案。本轮完成架构准备，知识库功能待开发。

## 历史时空维护与剩余事项

1. 批量目录和下载账本都在 Git 忽略的 `atlas-data/`。运行顺序和统计口径见 `docs/DATA_SOURCES.md`。Wikidata 的抓取与导入是分开的，抓取重跑复用完好的分片。每次更新 EventKG 或 Wikidata，按文档顺序刷新 QID 合并及 TextEvent 查重。发布检查运行 `node scripts/verify-event-catalog.mjs` 和 `npm test`。事件编辑表单及人工复核工作台尚未实现。
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
