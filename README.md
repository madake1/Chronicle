# Chronicle

用时间轴和离线历史地图探索世界历史的个人学习项目。可记录游戏、小说和影视作品的故事年代，也可独立查看政权疆界、历史地点和现代地理参照。

## 已有功能

- 作品库、故事时间轴、Markdown 笔记、插图与单份或批量导出。
- 历史地图支持公元前 3400 年至公元 2024 年、政权名称和别名搜索、疆域演变、百科链接。
- 历史地点按年份和视野加载，可搜索并查看名称、史料和出处。没有可靠年代的地点可搜索和定位。
- V4 历史事件随地图年份显示，可按类别和关键词筛选，查看简介、点位和出处。
- Cliopatria 自由年份地图和 Historical Basemaps 固定快照可切换。海岸线、河流和山地标为现代参照。

## 安装和启动

需要 Node.js 20.19 或更新版本。首次准备地图时需要网络。

```powershell
npm ci
npm run atlas:prepare
npm start
```

打开 [http://127.0.0.1:4173](http://127.0.0.1:4173/)，历史地图在 `/atlas`。若设置了 `PORT`，以终端显示的地址为准。启动新版前先关闭原来的 Chronicle 实例。需要对照快照时，首次运行 `npm run atlas:prepare -- --with-comparison`。

作品保存在 `data/`，请备份。地图和外部地点的本地文件在 `atlas-data/`，新装时需按 [数据源清单](docs/DATA_SOURCES.md) 恢复或导入已有资料包。已准备的数据可离线使用。

## 架构

Node.js HTTP 服务 + 原生 HTML、CSS 和 ES Modules + MapLibre GL JS。作品索引、地图索引使用 JSON，笔记使用 Markdown，无 SQLite 或云端服务。

| 目录 | 用途 |
|---|---|
| `public/` | 作品库、时间轴、笔记和历史地图前端 |
| `scripts/` | 下载底图、预处理疆界、导入地点、生成本地索引 |
| `atlas-places/` | 小型来源记录和导入元数据 |
| `atlas-data/` | 本地原始地图数据、地点包和生成索引，Git 忽略 |
| `data/` | 个人作品、笔记和图片，Git 忽略 |

## 数据与维护

已接入 Cliopatria、Natural Earth、Historical Basemaps、Pleiades、WHG、日本 CODH、Viabundus、Reba 等的全球历史城市，以及 Wikipedia/Wikidata 名称关联。可搜索 GeoNames 全球现代城市和首都作为地理参照。历史覆盖随地区和年代变化，中国古代地名仍稀疏。

开发接手请先读 [数据源清单](docs/DATA_SOURCES.md) 和 [交接说明](docs/HANDOFF.md)，再检查实际工作区。测试运行 `npm test`。
