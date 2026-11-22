# 数据源维护清单

核验日期：2026-11-22。数字来自本机原始包、生成索引和导入统计。

当前地点索引 **70,612 条**，有年代依据 **23,469 条**（其中 **23,459 条**与地图年份相交），仅可搜索 **47,143 条**。以下「有效」指导入后可搜索且有可用坐标；「按年」指有年代依据。源数据量和导入数不能相互替代。

## 地点数据

原始文件路径以 `atlas-data/raw/` 为根。归一化后存于 `atlas-data/place-packs/<id>.json`；构建或导入时生成 `atlas-data/place-query-index.json`。常规入口为 `scripts/import-places.mjs`，LPF 和 Pleiades 规则在 `scripts/import-place-data.mjs`。

| 数据源 / 主要覆盖 | 下载 / 导入 | 原始记录 / 有效 / 按年 | 本机原始文件 | 版本或目录日期 / 许可 |
|---|---|---:|---|---|
| [Pleiades 完整快照](https://pleiades.stoa.org/downloads)，古典地中海、近东和周边 | 已下载 / 部分导入 | 42,439 / 13,725 / 4,211 | `pleiades-places-latest.json.gz` | 本地获取于 2026-11-22，`SHA-256 67e022bae17b`；CC BY 3.0 |
| [CODH 日本历史设施与地点](https://geoshape.ex.nii.ac.jp/nrct-poi/)，日本寺社、城址与遗迹等 | 已下载 / 已导入 | 32,038 / 32,038 / 0 | `nrct-poi-20261118.csv` | 2026-11-18；CC BY 4.0 |
| [Viabundus v2](https://zenodo.org/records/16611998)，晚期中世纪与近代早期北欧及周边 | 部分下载 / 部分导入 | 18,839 节点 / 3,112 / 3,108 | `viabundus-2-nodes.csv`、`viabundus-2-alternativenames.csv` | v2，2025-04-25；CC BY-SA 4.0 |
| [WHG · African Ports, 1887](https://whgazetteer.org/datasets/657/places)，西非海岸，1887 年 | 已下载 / 部分导入 | 305 / 6 / 0 | `whg_dataset_657.lpf` | 2025-09-28；CC BY 4.0 |
| [WHG · 西高止山脉佛教石窟](https://whgazetteer.org/datasets/693/places)，印度西高止山脉，公元前 2 世纪至公元 5 世纪初 | 已下载 / 已导入 | 55 / 55 / 54 | `whg_dataset_693.lpf` | 2023-11-06；CC BY 4.0 |
| [WHG · 14 世纪末俄罗斯城镇名录](https://whgazetteer.org/datasets/764/places)，东欧，14 世纪末 | 已下载 / 已导入 | 282 / 282 / 276 | `whg_dataset_764.lpf` | 2021-11-25；CC BY 4.0 |
| [WHG · Poland localities in the 16th Century](https://whgazetteer.org/datasets/1121/places)，波兰，16 世纪 | 已下载 / 部分导入 | 24,498 / 11,471 / 10,882 | `whg_dataset_1121.lpf` | 2022；CC BY 4.0 |
| [WHG · 中国省份，1911](https://whgazetteer.org/datasets/1203/places)，中国省份参考点，1911 年 | 已下载 / 部分导入 | 27 / 20 / 19 | `whg_dataset_1203.lpf` | 2023-04-14；CC0 1.0 |
| [WHG · 法显赴印度行记](https://whgazetteer.org/datasets/1354/places)，中国至印度，399–414 年路线 | 已下载 / 未导入 | 18 / 0 / 0 | `whg_dataset_1354.lpf` | 2025-05-12；CC BY 4.0 |
| [WHG · 图德拉的本雅明旅行路线](https://whgazetteer.org/datasets/1365/places)，欧洲至中东，中世纪旅行 | 已下载 / 部分导入 | 215 / 36 / 36 | `whg_dataset_1365.lpf` | 2023-11-07；CC BY 4.0 |
| [WHG · 1880 年非洲地图](https://whgazetteer.org/datasets/1451/places)，非洲，1880 年地图 | 已下载 / 部分导入 | 1,322 / 1,318 / 1,318 | `whg_dataset_1451.lpf` | 2024-03-20；CC BY 4.0 |
| [WHG · 鲁汶大学历史相关地点](https://whgazetteer.org/datasets/1501/places)，欧洲为主，1425–1797 年相关资料 | 已下载 / 部分导入 | 9,058 / 3,677 / 0 | `whg_dataset_1501.lpf` | 2024-07-02；CC BY 4.0 |
| [WHG · UNESCO 世界遗产地点](https://whgazetteer.org/datasets/1535/places)，全球，2023 年世界遗产名录 | 已下载 / 部分导入 | 1,197 / 1,196 / 0 | `whg_dataset_1535.lpf` | 2024-08-27；CC BY 4.0 |
| [WHG · Medieval Swahili Coast](https://whgazetteer.org/datasets/1618/places)，中世纪东非海岸 | 已下载 / 部分导入 | 278 / 110 / 0 | `whg_dataset_1618.lpf` | 2025-09-18；CC BY 4.0 |
| [WHG · Settlements in the Kingdom of Romania, 1904–1913](https://whgazetteer.org/datasets/1631/places)，罗马尼亚，1904–1913 年 | 已下载 / 未导入 | 10,036 / 0 / 0 | `whg_dataset_1631.lpf` | 2025-07-02；CC BY 4.0 |
| [WHG · 台湾历史村落地名录](https://whgazetteer.org/datasets/1643/places)，台湾村落，17–20 世纪 | 已下载 / 未导入 | 246 / 0 / 0 | `whg_dataset_1643.lpf` | 2025-05-29；CC BY 4.0 |
| [WHG · Belgian Historical Gazetteer](https://whgazetteer.org/datasets/1756/places)，比利时安特卫普、东弗兰德斯，1847–1855 年左右 | 已下载 / 已导入 | 3,548 / 3,548 / 3,547 | `whg_dataset_1756.lpf` | 2026；CC BY 4.0 |

- Pleiades 使用官方完整 gzip JSON。筛掉缺少可靠点位、受支持类型或其他入库条件的记录；留下原始 ID、名称、史料和出处。请先检查现存原包及哈希，再考虑更新。库内另有 4 条 Pleiades 小型摘录。
- WHG 通过官网登录后逐套导出。截至核验，本机 14 份 LPF 均已尝试，11 套产生有效地点。每套的本地导入参数见 `atlas-data/raw/whg-<编号>.json`。筛选还会排除无坐标、多点含义不明或类型不适配的记录。台湾村落与罗马尼亚聚落导出无点，法显包未达到当前点位和类型条件。UNESCO 名录日期是收录语境，作为仅搜索来源。
- CODH 原表无地点年代。代表坐标有的按现代地址或行政区推定。导入保留编号、日文原名、假名读音、原分类和来源中的现址，不推断年代。署名：『日本歴史地名大系』施設・地点項目データセット（CODH作成），doi:10.20676/00000456。
- Viabundus 的节点和别名表从官方 Zenodo 下载，两个文件均通过发布方 MD5 核对；别名表 30,624 行。仅取上游标记完备的聚落与城镇节点，单个年代端点只作该年记载，双端点保留资料范围。改编产物单独存放，分发时保留署名与 CC BY-SA 4.0。路线和其他要素本轮未导入。
- 另有 14 条带逐项出处的研究补充（含北宋四京），以及上述 4 条 Pleiades 摘录。文件为 `public/atlas/northern-song-places.json`、`atlas-places/curated.json`、`atlas-places/pleiades.json`，随 `atlas:places` 导入。保留人工核实名称和身份；不同来源只在有明确的对应关系时合并。

## 地图、名称与用户资料

| 数据源 | 范围、记录与状态 | 获取和本地位置 | 版本、许可与限制 |
|---|---|---|---|
| [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria/releases/tag/v0.2.1) | 全球不均匀，前 3400–2024；已下载并导入 13,412 条政权记录、2,740 个分组 | `atlas:prepare` 获取 `raw/cliopatria-v0.2.1.zip`，生成 `chronology.json` 和几何分片 | v0.2.1，CC BY 4.0；记录有效期表示资料覆盖 |
| [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) | 全球现代地理；1:110m 陆地／湖泊 127／24，1:50m 陆地／湖泊／河流 1,420／412／359，1:10m 为 11／1,355／385，山脉 3 条；已下载并导入 | `atlas:prepare` 获取 `raw/natural-earth-v5.1.2-*`，生成各精度地理索引 | v5.1.2，Public Domain；只作现代地理参照 |
| [Historical Basemaps](https://github.com/aourednik/historical-basemaps/tree/4b5039e50d8d2464b065bd76ad6086cd4597108d) | 全球离散历史快照；前 2000、前 500、1200 年分别为 145／189／286 个要素；已下载并导入三张 | `atlas:prepare -- --with-comparison`；`raw/*-world_*.geojson`、`comparison*.geojson` 与上游许可 | 固定提交 `4b5039e`；仓库 GPL-3.0，部分图来自改编，项目仅本地下载，不随仓库分发；夏朝是来源重建示意 |
| [Wikipedia](https://www.wikipedia.org/) / [Wikidata](https://www.wikidata.org/wiki/Wikidata:Licensing) | 全球各时期政权名称和关联；已下载索引并导入，2,641 个分组有中文名，2,735 个有百科链接 | `atlas:prepare -- --refresh-encyclopedia` 调官方 API；`atlas-encyclopedia.json` 和手工补充 `atlas-polity-aliases.json` | 本地快照于 2026-11-22 核查；Wikidata 结构化数据 CC0；Wikipedia 只保存名称与链接 |
| 本机作品及笔记 | 用户内容，数量随使用变化；`fixtures.json` 仅首次无作品索引时回退 | `data/chronicle.json`；笔记、图片同在 `data/` | 私有数据，备份优先级最高 |

## 尚未完成的数据

- WHG 新查询：`https://whgazetteer.org/entity/dataset:1245/api` 未认证的命令行请求返回 403。随后核对现有 ORCID 登录会话，Viabundus 页面可见 LPF 导出，但版本为 v1.2，本机已从发布者处导入 v2，故未重复下载。中国 1911 年城镇在登录后仍显示下载不可用；县、府此前也未出现可用导出。本轮没有新增 WHG 包。直接从 [WHG 目录](https://whgazetteer.org/public_data/) 核查逐套许可及可用性。
- Viabundus 的发布者整包传输未完成；已从同一版本的 Zenodo 取得并使用校验通过的节点与别名。整包、路线和城镇轮廓未检验或导入。
- [CODH 行政地名变迁](https://geoshape.ex.nii.ac.jp/gch/index.html.ja)：江户至 1889 年，2023-10-18 版，CC BY 4.0。本轮未下载或导入，需检查可匹配的坐标 ID。
- [CHGIS V6](https://chgis.fas.harvard.edu/data/chgis/v6/)：中国历史行政地理，版本 2016。原版未下载或导入，官网限制商业使用和再分发；WHG 的获准省份子集单独计算。
- [OpenHistoricalMap](https://wiki.openstreetmap.org/wiki/OpenHistoricalMap/Reuse)：全球覆盖不均匀。可用官方区域提取，通常 CC0，逐要素核对例外。尚未下载或导入。

## WHG 认证和凭据

- 当前仓库没有可用的 WHG 认证配置，导入器只读取本地 LPF。先在 [WHG](https://whgazetteer.org/) 使用 ORCID 官方登录，再进入数据集的 Download options → Download LPF。遵守站点显示的条款与请求频率限制。
- 若未来使用官方 API，请按 [WHG API 文档](https://docs.whgazetteer.org/content/technical/apis.html) 在账户配置页创建令牌。约定放在项目根目录私有 `.env.local` 的 `WHG_API_TOKEN`，可在调用 API 前读取到进程环境。现有 Chronicle 脚本不读取这个变量，也没有创建令牌。不要把 ORCID 密码加入项目。
- 已用 `git check-ignore` 检查 `.env`、`.env.local` 和 `credentials/`。它们均被忽略。禁止把凭据值或会话 Cookie 写入日志、源码、文档或 Git。

## 重建与更新

```powershell
npm run atlas:places
npm run atlas:import-places -- pleiades atlas-data/raw/pleiades-places-latest.json.gz
npm run atlas:import-places -- lpf atlas-data/raw/whg_dataset_1618.lpf atlas-data/raw/whg-1618.json
python scripts/prepare-codh-poi.py atlas-data/raw/nrct-poi-20261118.csv atlas-data/raw/codh-japan-poi.lpf
npm run atlas:import-places -- lpf atlas-data/raw/codh-japan-poi.lpf atlas-places/codh-japan-poi.json
python scripts/prepare-viabundus.py atlas-data/raw/viabundus-2-nodes.csv atlas-data/raw/viabundus-2-alternativenames.csv atlas-data/raw/viabundus-v2.lpf
npm run atlas:import-places -- lpf atlas-data/raw/viabundus-v2.lpf atlas-places/viabundus-v2.json
```

首次导入或更新单个来源时才跑对应导入命令。仅重建索引用 `atlas:places`。处理完成后重启本机服务。
