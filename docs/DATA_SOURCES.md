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
| 本机作品及笔记 | 用户内容，数量随使用变化；`fixtures.json` 仅首次无作品索引时回退 | `data/chronicle.json`；笔记、图片同在 `data/` | 私有数据，备份优先级最高 |

## 历史事件（V4）

`public/atlas/events.json` 版本 `1.0.0`，2026-11-22 人工整理并已随程序加载。共 26 条，12 条含点位，14 条仅在列表显示，5 条通过稳定 ID 关联已有地点。类别分布为政治 8、战争 6、经济 2、宗教 3、科学与技术 2、文化与艺术 2、社会 3。

- 各条记录的 `sources` 保存文献标题与链接，包括 [English Heritage 1066 年大事记](https://www.english-heritage.org.uk/learn/teaching-resources/story-of-1066/)、[英国皇家军械博物馆百年战争](https://royalarmouries.org/objects-and-stories/stories/the-hundred-years-war-1337-1453)、[史密森中国历史时间线](https://asia.si.edu/education/educator-resources/teaching-china-with-the-smithsonian/interactives/timelines/timeline-of-chinese-history-art-and-culture/)、[新西兰文化与遗产部条约史](https://nzhistory.govt.nz/politics/treaty/making-the-treaty/signing-the-treaty)和 [NASA Apollo 11](https://www.nasa.gov/mission/apollo-11/)。简介为本项目中文摘要。外部来源的原文、图片和数据各依发布者许可，当前仅引用链接及事实，没有下载或导入整套外部事件资料。
- `startYear` 和 `endYear` 使用带符号的历史年份，公元前为负数，公元后为正数，均含端点。精度为 `year` 时按单年或持续区间筛选。`century` 和 `approximate` 必须附 `dateLabel`，区间是可能范围，显示在其中任一年不代表该年已获证实。
- `location` 为经度、纬度，须由可核验的场址、历史城市或遗址资料支持。`placeId` 只记录经人工核对的关联。事件点位与关联地点的地图点位分别维护。多地持续进程和未核实地点可填写 `placeName`，省略坐标。
- 新增事件时保留稳定 ID，填写来源和日期精度，运行 `npm test` 校验，再在地图切到相应年代复查。数据和简介离线可读，打开来源链接需要联网。首批资料仅覆盖少数时期和地区，不能用于判断某年是否没有发生其他事件。

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
