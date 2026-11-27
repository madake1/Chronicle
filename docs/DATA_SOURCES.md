# 数据源维护清单

核验日期：2026-11-22。数字来自本机原始包、生成索引和导入统计。

当前地点索引 **123,199 条**，有年代依据 **39,263 条**（其中 **39,253 条**与地图年份相交），仅可搜索 **83,936 条**。「有效」指导入后可搜索且有可用坐标，「按年」指有年代依据。不同来源的记录可能指同一地点。

## 地点数据

原始文件路径以 `atlas-data/raw/` 为根。归一化后存于 `atlas-data/place-packs/<id>.json`；构建或导入时生成 `atlas-data/place-query-index.json`。常规入口为 `scripts/import-places.mjs`，LPF 和 Pleiades 规则在 `scripts/import-place-data.mjs`。

| 数据源 / 主要覆盖 | 下载 / 导入 | 原始记录 / 有效 / 按年 | 本机原始文件 | 版本或目录日期 / 许可 |
|---|---|---:|---|---|
| [GeoNames cities15000](https://download.geonames.org/export/dump/readme.txt)，全球现代城市 | 已下载 / 已导入 | 34,249 / 34,249 / 0 | `geonames-cities15000.zip` | SHA-256 a15729cf9954，CC BY 4.0 |
| [Reba 等，全球历史城市](https://doi.org/10.1038/sdata.2016.34)，Chandler 与 Modelski 古代集 | 已下载 / 部分导入 | 1,751 / 1,520 / 1,520 | `chandlerV2.csv`、`modelskiAncientV2.csv` | 两份 V2 CSV，CC BY 4.0 |
| [WHG · 中亚历史图集](https://whgazetteer.org/datasets/838/places) | 已下载 / 部分导入 | 759 / 482 / 4 | `whg_dataset_838.lpf` | 2025-09-18，CC BY 4.0 |
| [WHG · Dati 的《球体》地名](https://whgazetteer.org/datasets/1760/places)，晚期中世纪欧洲、地中海及周边 | 已下载 / 部分导入 | 369 / 298 / 298 | `whg_dataset_1760.lpf` | 2026-04-17，CC BY 4.0 |
| [WHG · 蒙塞拉特的莫卧儿印度旅行](https://whgazetteer.org/datasets/1575/places) | 已下载 / 部分导入 | 138 / 67 / 0 | `whg_dataset_1575.lpf` | 2025-05-22，CC BY 4.0 |
| [WHG · 西属美洲聚落](https://whgazetteer.org/datasets/14/places)，1701–1808 年来源 | 已下载 / 部分导入 | 13,259 / 12,174 / 11,795 | `whg_dataset_14.lpf` | 2025-09-03，CC BY-NC-SA 4.0 |
| [WHG · 旧大陆贸易地名](https://whgazetteer.org/datasets/12/places)，欧亚和非洲 | 已下载 / 部分导入 | 4,117 / 3,777 / 2,167 | `whg_dataset_12.lpf` | 2025-10-15，CC BY-NC 2.5 |
| [WHG · 忏悔者狄奥法内斯的保加利亚地名](https://whgazetteer.org/datasets/1361/places) | 已下载 / 部分导入 | 35 / 10 / 0 | `whg_dataset_1361.lpf` | 2025-09-18，CC BY 4.0 |
| [WHG · 佛罗里达原住民地名](https://whgazetteer.org/datasets/1076/places) | 已下载 / 部分导入 | 100 / 10 / 10 | `whg_dataset_1076.lpf` | Simpson 1956 / WHG 2022，原记录 Public Domain，WHG 补充 CC BY 4.0 |
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
- GeoNames 保留原名、别名、坐标和稳定编号。快照含 244 个国家或地区代码以及 241 条上游标为 `PPLC` 的首都记录，全部可搜索定位。快照分类不赋予历史身份时段。
- Reba 等两份原始 CSV 按 Figshare 发布 MD5 核对。仅选坐标置信等级 1、2 且有正数人口样本的记录。每个有观测的年份单独显示，中间年份不插值。来源中的城市名称可能是现代拼法。
- WHG 通过官网登录后逐套导出。本机共 21 份 LPF，18 套产生有效地点。导入参数见 `atlas-places/whg-<编号>.json` 或旧包所在的 `atlas-data/raw/whg-<编号>.json`。筛选排除无坐标、多点含义不明或类型不适配的记录。中亚图集标为较不确定的单点只供搜索定位。文献和地图的年代视为来源记载，不能推断聚落持续存在。台湾村落与罗马尼亚聚落导出无点，法显包未达到当前点位和类型条件。UNESCO 名录日期是收录语境，作为仅搜索来源。
- CC BY-NC 和 CC BY-NC-SA 数据仅用于本机非商业用途，原始包和归一化包均在 Git 忽略目录。WHG 对比对链接等补充内容的 CC BY 4.0 许可单独适用。
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
| 本机作品及笔记 | 用户内容，数量随使用变化；`fixtures.json` 仅用于显式初始化示例库 | `data/chronicle.json`；笔记、图片同在 `data/` | 私有数据，备份优先级最高 |

## 历史事件（V4）

`public/atlas/events.json` 版本 `1.0.0`，2026-11-22 人工整理并已随程序加载。共 26 条，12 条含点位，14 条仅在列表显示，5 条通过稳定 ID 关联已有地点。类别分布为政治 8、战争 6、经济 2、宗教 3、科学与技术 2、文化与艺术 2、社会 3。

- 各条记录的 `sources` 保存文献标题与链接，包括 [English Heritage 1066 年大事记](https://www.english-heritage.org.uk/learn/teaching-resources/story-of-1066/)、[英国皇家军械博物馆百年战争](https://royalarmouries.org/objects-and-stories/stories/the-hundred-years-war-1337-1453)、[史密森中国历史时间线](https://asia.si.edu/education/educator-resources/teaching-china-with-the-smithsonian/interactives/timelines/timeline-of-chinese-history-art-and-culture/)、[新西兰文化与遗产部条约史](https://nzhistory.govt.nz/politics/treaty/making-the-treaty/signing-the-treaty)和 [NASA Apollo 11](https://www.nasa.gov/mission/apollo-11/)。简介为本项目中文摘要。外部来源的原文、图片和数据各依发布者许可，当前仅引用链接及事实，没有下载或导入整套外部事件资料。
- `startYear` 和 `endYear` 使用带符号的历史年份，公元前为负数，公元后为正数，均含端点。精度为 `year` 时按单年或持续区间筛选。`century` 和 `approximate` 必须附 `dateLabel`，区间是可能范围，显示在其中任一年不代表该年已获证实。
- `location` 为经度、纬度，须由可核验的场址、历史城市或遗址资料支持。`placeId` 只记录经人工核对的关联。事件点位与关联地点的地图点位分别维护。多地持续进程和未核实地点可填写 `placeName`，省略坐标。
- 新增事件时保留稳定 ID，填写来源和日期精度，运行 `npm test` 校验，再在地图切到相应年代复查。数据和简介离线可读，打开来源链接需要联网。首批资料仅覆盖少数时期和地区，不能用于判断某年是否没有发生其他事件。

### 2026-11-23 扩充

原始 26 条保留在原文件。这一批新增 44 条，其中 22 条有点位，22 条只在列表显示。

| 快照 | 入库 | 来源及许可 |
|---|---:|---|
| `public/atlas/events-wikidata.json` | 35 / 45 个候选，19 条有点位 | 2026-11-23 从英文站点链接解析 Wikidata QID，逐条核对 UNESCO、博物馆、档案馆和研究机构资料。Wikidata 结构化数据 CC0。机构资料只保留链接和本项目中文摘要。 [Wikidata 数据许可](https://www.wikidata.org/wiki/Wikidata:Licensing) |
| `public/atlas/events-noaa.json` | 9 条，含 4 条公元前记录及 3 条震中点位 | 2026-11-23 NOAA NCEI HazEL 原始 JSON，官方目录标为 CC0。 [官方数据目录](https://catalog.data.gov/dataset/ncei-wds-global-significant-earthquake-database-2150-bc-to-present) |

- Wikidata 的 QID 标识所参考的事件、历史阶段或遗址。年代以机构资料为准，遗址的营建或繁荣阶段与遗产名录公布年份分开。遗址坐标可采用经机构确认身份的 Wikidata P625 或机构地图代表点。只有地区、跨区域或没有已核验点位的记录保留在列表。大津巴布韦、平安京和特诺奇蒂特兰关联已有地点 ID。
- 用上游数据集名与 ID 去重。逐项对照原有 26 条的主题、时间和地点，未发现重复事件。特诺奇蒂特兰传统建城纪年与既有 1521 年陷落分别保留，两者指不同事件。
- 跨年阶段按区间含端点展示。公元前 NOAA 样本使用 `reported-year`，只在目录标注年份显示，明确标为未经独立核定，不推断误差范围。地震样本中关东、瓦尔迪维亚和苏门答腊采用目录震中。古地震、1556 年陕西和 1700 年卡斯卡迪亚保留目录地区文字。
- 待核实 10 个候选。梅尔内普塔石碑（Q754378）、印度河文明总条目（Q42534）、高丽（Q28208）、卡拉尔（Q219279）、澳大利亚 1967 年公投（Q4825132）、大理国（Q26472）、满者伯夷（Q49326）、乌鲁克时期（Q731494）暂缓，需补实具体事件边界、与已入库阶段的关系或直接机构资料。毛利人早期定居与菲律宾独立未从本次使用的站点标题解析到 QID。万隆会议已入库，地图点位留待复核。

NOAA 样本的复核名单、中文名称和是否采用震中由 `atlas-events/noaa-sample.json` 管理。原始快照可由 HazEL 重新下载。重抓时应记录新的获取日期，复核上游修订再运行导入。

```powershell
$endpoint = 'https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/earthquakes'
curl.exe -fL "${endpoint}?maxYear=-1" -o atlas-data/raw/noaa-earthquakes-bce.json
foreach ($year in 1556,1700,1923,1960,2004) {
  curl.exe -fL "${endpoint}?minYear=$year&maxYear=$year" -o "atlas-data/raw/noaa-earthquakes-$year.json"
}
$files = 'bce','1556','1700','1923','1960','2004' | ForEach-Object { "atlas-data/raw/noaa-earthquakes-$_.json" }
node scripts/import-noaa-events.mjs @files
npm test
```

### 全球大事记（2026-11-23）

`public/atlas/events-milestones.json` 独立收录 **80 条经机构资料整理的大事件**，时间约从公元前 3200 年到 2020 年，发布后四套数据合计 **150 条**。本批含政治 47、战争 6、经济 4、宗教 1、科学与技术 9、文化与艺术 5、社会 6、自然灾害 2。12 条有可核验点位，区域性或多地事件仍留在列表。

同日的 **1.1 版**继续新增 **50 条**，大事记共 130 条，四套数据总计 **200 条**。新增覆盖古代阿卡德与希腊、南亚王朝、毛利早期定居、大洋洲社会史、非洲与亚洲独立进程、国际公约和航天。5 条附地图点位。近现代独立和政治制度事件占本轮较大比例。 [澳大利亚国家博物馆 · 历史节点](https://www.nma.gov.au/defining-moments/defining-moments-timeline) · [联合国维和史](https://peacekeeping.un.org/en/our-history) · [NASA · 韦伯发射](https://science.nasa.gov/mission/webb/launch/)

- 古代和中世纪补早期楔形文字、孔雀王朝、隋代大运河、阿拔斯都城、东亚王朝更替和黑死病。近现代补独立与非殖民化、两次世界大战、联合国、货币体系、公共卫生、太空和互联网。来源直接见每条记录，中文简介为本项目整理。 [大都会艺术博物馆 · 文字起源](https://www.metmuseum.org/de/essays/the-origins-of-writing) · [联合国宪章](https://www.un.org/en/about-us/un-charter/) · [CERN · 万维网的诞生](https://home.cern/science/computing/the-birth-of-the-web/)
- 这一批以本项目稳定 ID 维护，并与旧包对照。高丽建立、菲律宾在 1946 年获美国承认独立、澳大利亚 1967 年原住民事务公投已按机构资料独立入库。原 Wikidata 候选记录保留初审结果。终年只是特定历史阶段的终点，例如黑死病的首轮欧洲传播。

### 批量目录（2026-11-23 快照）

2026-11-24 分类复核使用同一快照的直接 Wikidata 类型。原归「其他事件」的 26,675 条命名记录改归政治 8,312、科学与技术 8,470、文化与艺术 9,893。仅在明确类型指向同一类别时重新归类，日期和重复记录的复核规则照常适用。逐条依据见 `atlas-data/raw/eventkg-3.2/category-review.jsonl.gz`，重跑 `python scripts/import-eventkg.py 2026-11-23` 可以重建。抽查包括 2020 年新斯科舍市政选举、1969 年莫斯巴赫学术研讨会和 Neil Young 1973 年巡演。

地图仍默认显示原有 200 条精选。切换到「全部事件」可按当前年份、地区、类别和关键词检索目录。目录标题可使用上游语言。「原始目录」表示结构化或文本来源的批量记录，详情提供版本、定位依据和原始来源。近代记录较密，地区筛选只使用已知地区或多地来源明确列出的各地。

11 月 23 日批量快照验收为 1,381,950 条唯一事件、20,873 条可上图和 96 条地点关联。11 月 24 日加入区域精选后，全库为 **1,381,960 条唯一事件**，包含 210 条精选，20,880 条可上图，97 条可跳转已有地点。完整统计见 `atlas-data/events-catalog/verification.json`。约 79% 的事件始于 1900 年及以后，古代非洲、美洲和大洋洲的可定位素材仍较稀疏。

区域专题存于 `public/atlas/events-regional.json`。古代非洲 3 条、前哥伦布时期美洲 3 条、大洋洲 4 条，最早补到约公元前 2600 年。7 条采用 UNESCO 遗址点位，其中阿尔班山关联现有历史城市记录。杰内杰诺、特乌马和努库莱卡保留地名和出处，待核实场址坐标。放射性碳测年的 cal BP 以 1950 年为基准折算为无公元零年的历史年份，条目保留校准范围。

| 来源 | 处理范围与断点 | 许可 |
|---|---|---|
| [NOAA 全球显著地震目录](https://catalog.data.gov/dataset/ncei-wds-global-significant-earthquake-database-2150-bc-to-present) | HazEL API 查询公元前 3400 至 2024 年。34 页共 6,634 个唯一 ID，匹配精选 9，新增 6,625，其中 4,022 有目录报告的震中，待复核及排除均为 0。完整分页和逐 ID 结果在 `atlas-data/raw/noaa-2026-11-23/`。 | 官方目录标为 CC0 |
| [EventKG 3.2 命名事件](https://eventkg.l3s.uni-hannover.de/data.html) | 扫描全部 `events.nq`、`relations_events_base.nq` 和 `types_wikidata.nq`。993,268 个命名 ID 各有一项结果，643,765 入库候选，39 匹配精选，344,525 待复核，4,939 排除。另在跨库复核中暂缓 1,027 条入库候选，最终展示新增 642,738 条。缺可采用年代 271,258，日期冲突 73,260，明显异常终年 6，无名称 1。排除中 4,528 超出时间轴，411 为 Wikidata 明确标记的非事件类型。 | Simon Gottschalk、Elena Demidova，L3S Research Center，[EventKG v3.2](https://zenodo.org/records/10424118) 与 [CC BY 4.0](https://eventkg.l3s.uni-hannover.de/schema_model.html) |
| [EventKG 3.2 TextEvent](https://eventkg.l3s.uni-hannover.de/data.html) | 扫描发布者独立分库 `text_events.nq`。709,689 个显式 TextEvent ID，新增 703,384，匹配已有 5,564，待复核 103，超出时间轴 638。另有 36,697 个仅含辅助语句的其他主体，未计为 TextEvent。保留百科贡献者署名及具体页面。 | EventKG CC BY 4.0。百科摘录遵循来源页的 CC BY-SA 条款。 |
| [Wikidata Query Service](https://query.wikidata.org/) | 按脚本声明的直接 `P31` 类型，从公元前 3400 至 2024 年的十个时期查询首选层级 `P585` 或 `P580`，另保留 `P582`、精度、历法、地点和坐标。80 个原始查询拆为 120 个最终分片，全部完成。70,516 条查询结果归并成 57,378 个唯一 QID，新增 29,003，匹配已有 24,882，待复核 3,493，排除 0。未枚举类型、仅用其他属性记载时间和无日期的实体不属于查询范围。 | 结构化数据 [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing) |

- 同一上游 ID 可复用已精选的稳定本机 ID。Wikidata 与 EventKG 的同一 QID 优先合并证据，日期互相不重合则留在复核表。与 NOAA 同日、坐标相近的地震候选单列复核，关联的 EventKG 候选也暂不展示。不同 QID 或不同语言的转述可能仍含语义重复。
- 见不到精确事件点时，保留来源地点名称或地区。Wikidata 只采用事件自身的单一 P625 坐标。P276 与地点索引的显式 QID 唯一吻合时，可启用「查看关联地点」。NOAA 的 1900 年以前震中不自动采用。EventKG 的上游地点节点 ID 保留在来源元数据，节点 ID 本身不能生成点位。
- 日期原值、来源图和精度保存在机器可读出处。区间两端包含在内，世纪、千年、十年或约年保留范围。文本目录日期只使用上游抽取结果。EventKG 命名文件与文本分库分别建账，名义范围由发布者文件限定。人物、关系网络和描述扩展文件未导入。本轮未连接 EventKG 30.6 GB 实体名文件和 23 GB 实体关系文件，后者保留了可断点续传的片段。当前 EventKG 地理覆盖主要取决于可合并的 Wikidata 补充。
- 本机完整重建需要 Node.js、Python 3 和支持 Range 的 curl。下载存于忽略的 `atlas-data/raw/`，软件离线读取 `atlas-data/events-catalog/`。重新运行同一个采集日期会沿用已成功的分页、离线文件和查询分片。EventKG 3.2 文件长度和 SHA-256 见 `eventkg-3.2/snapshot-integrity.json`，年代解析和文本重排各有检查点。为保持快照，需另备份目录原始文件和账本。
- 逐条账本包括 NOAA 的 `outcomes.json`，EventKG 的 `outcomes.jsonl.gz`、`text-outcomes.jsonl.gz`，以及 Wikidata 的 `manifest.json` 和 `outcomes.json`。Wikidata 待复核中，1,420 缺名、1,185 与 NOAA 可能重合、540 与 EventKG 日期不重合、322 内部日期冲突、17 历法或日期限定词不能安全解释、9 起止倒置。

```powershell
node scripts/update-noaa-catalog.mjs 2026-11-23
python scripts/import-eventkg.py 2026-11-23 --download
python scripts/fetch-wikidata-events.py 2026-11-23
python scripts/import-wikidata-catalog.py 2026-11-23
python scripts/import-eventkg-text.py 2026-11-23 --download
node scripts/verify-event-catalog.mjs
npm test
```

## 尚未完成的数据

- WHG 的 Viabundus 下载为 v1.2，本机使用发布者 v2。中国 1911 年城镇此前在登录后仍显示下载不可用，县、府此前也未出现可用导出。[WHG 目录](https://whgazetteer.org/public_data/)
- Viabundus 的发布者整包传输未完成；已从同一版本的 Zenodo 取得并使用校验通过的节点与别名。整包、路线和城镇轮廓未检验或导入。
- [CODH 行政地名变迁](https://geoshape.ex.nii.ac.jp/gch/index.html.ja)：江户至 1889 年，2023-10-18 版，CC BY 4.0。本轮未下载或导入，需检查可匹配的坐标 ID。
- [CHGIS V6](https://chgis.fas.harvard.edu/data/chgis/v6/)：中国历史行政地理，版本 2016。原版未下载或导入，官网限制商业使用和再分发；WHG 的获准省份子集单独计算。
- [OpenHistoricalMap](https://wiki.openstreetmap.org/wiki/OpenHistoricalMap/Reuse)：全球覆盖不均匀。可用官方区域提取，通常 CC0，逐要素核对例外。尚未下载或导入。

## WHG 认证和凭据

- 当前仓库没有可用的 WHG 认证配置，导入器只读取本地 LPF。先在 [WHG](https://whgazetteer.org/) 使用 ORCID 官方登录，再进入数据集的 Download options → Download LPF。遵守站点显示的条款与请求频率限制。
- 用户已授权本项目按页面显示的许可和 WHG 下载政策下载公开数据，用于个人非商业使用。后续仅使用 Codex 内置浏览器，优先复用该浏览器的现有登录会话。
- 若未来使用官方 API，请按 [WHG API 文档](https://docs.whgazetteer.org/content/technical/apis.html) 在账户配置页创建令牌。约定放在项目根目录私有 `.env.local` 的 `WHG_API_TOKEN`，可在调用 API 前读取到进程环境。现有 Chronicle 脚本不读取这个变量，也没有创建令牌。不要把 ORCID 密码加入项目。
- 已用 `git check-ignore` 检查 `.env`、`.env.local` 和 `credentials/`。它们均被忽略。禁止把凭据值或会话 Cookie 写入日志、源码、文档或 Git。

## 重建与更新

```powershell
npm run atlas:places
curl.exe -fL https://download.geonames.org/export/dump/cities15000.zip -o atlas-data/raw/geonames-cities15000.zip
node scripts/import-geonames.mjs
curl.exe -fL https://ndownloader.figshare.com/files/5407640 -o atlas-data/raw/chandlerV2.csv
curl.exe -fL https://ndownloader.figshare.com/files/5356132 -o atlas-data/raw/modelskiAncientV2.csv
python scripts/prepare-historical-cities.py
npm run atlas:import-places -- lpf atlas-data/raw/historical-cities.lpf atlas-places/historical-cities.json
foreach ($id in 838,1760,1575,14,12,1361,1076) {
  npm run atlas:import-places -- lpf "atlas-data/raw/whg_dataset_$id.lpf" "atlas-places/whg-$id.json"
}
npm run atlas:import-places -- pleiades atlas-data/raw/pleiades-places-latest.json.gz
npm run atlas:import-places -- lpf atlas-data/raw/whg_dataset_1618.lpf atlas-data/raw/whg-1618.json
python scripts/prepare-codh-poi.py atlas-data/raw/nrct-poi-20261118.csv atlas-data/raw/codh-japan-poi.lpf
npm run atlas:import-places -- lpf atlas-data/raw/codh-japan-poi.lpf atlas-places/codh-japan-poi.json
python scripts/prepare-viabundus.py atlas-data/raw/viabundus-2-nodes.csv atlas-data/raw/viabundus-2-alternativenames.csv atlas-data/raw/viabundus-v2.lpf
npm run atlas:import-places -- lpf atlas-data/raw/viabundus-v2.lpf atlas-places/viabundus-v2.json
```

首次导入或更新单个来源时才跑对应导入命令。仅重建索引用 `atlas:places`。处理完成后重启本机服务。
