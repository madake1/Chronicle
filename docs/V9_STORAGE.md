# V9.0 个人资料存储

V9 使用全新 SQLite 库。V7.1 和 V8 的文件格式及迁移不进入 V9。V8 已合入 main，V7.1 停止分发，历史标签保留。旧 release 分支流程暂停。V9.1 接入正式 Tiptap 编辑器以及单篇 HTML、PDF 和 Markdown ZIP 导出。V9.2 做界面优化。

## 数据与事务

- 每个资料目录含一个 `chronicle.sqlite`。模块校验 SQLite 应用标记、`user_version` 和资料库模式。日志、配置、个人数据库与 `atlas-data/` 相互独立。开发默认使用独立局部目录，演示必须显式启用。
- `personal-library.mjs` 提供事务、外键及快照；`personal-store.mjs` 是 HTTP 业务的个人资料存储入口。作品、知识、专题和文档有稳定 ID。标签关系、专题作品关系、双向关联与有序文章块由外键约束。
- 所有正文使用 `documents` 表和正文 schema 1。保存只更新当前行，知识和作品笔记使用独立随机修订令牌，专题使用乐观版本号。删除知识时，引用块继续保留原 ID、原位置及标题提示。有效专题反查和个人时空从当前资料派生。
- `personal-document-schema.mjs` 通过 Tiptap 的 `getSchema` 建立实际 ProseMirror schema，并调用 `Node.check()` 检验正文。使用标准表格行、单元格及段落，扩展单元格对齐、软换行和图片附件属性。支持标题、列表、引用、代码块、粗体、斜体、删除线、链接、行内代码和换行。过渡编辑器将 JSON 转成规范 Markdown，排版标记如链接写法可被规范化；无法表示的内容返回错误并保留原记录。
- 图片 BLOB 在整库按 SHA-256 去重。正文中的可访问图片需要所有者授权，保存事务同步附件关系。草稿上传租约为 24 小时；正文写入和清理检查所有有效引用和草稿。外部图片仍按原界面规则显示替代文字，内嵌 Base64 图片应使用附件上传。
- 作品摘要、简评等纯文本留在各自元数据中。历史时空数据、地图查询与构建流程沿用原有格式。

## 初始化、备份与恢复

源码启动需要 Node.js 24。正式模式下，设 `CHRONICLE_MODE=formal`、绝对 `CHRONICLE_DATA_DIR` 和 `CHRONICLE_INIT=1`，指定尚不存在的独立资料目录可初始化。便携首次使用默认目录可由 BAT 初始化。已经存在的资料目录缺库时，服务拒绝创建空库。V9 不读取旧 JSON 或 Markdown 文件库。

使用下列命令创建经校验的单文件 SQLite 快照。便携版可用 `runtime/node.exe app/scripts/personal-library.mjs` 代替命令前缀。第三个参数选择与资料库匹配的模式。

```powershell
node scripts/personal-library.mjs backup formal E:/Chronicle/V9-Library E:/Chronicle/Backups/v9-latest.sqlite
node scripts/personal-library.mjs restore formal E:/Chronicle/V9-Library E:/Chronicle/Backups/v9-latest.sqlite E:/Chronicle/Backups/v9-before-restore.sqlite
```

备份允许服务运行，包含 WAL 中已提交的数据。恢复须停止服务，维护工具获取同一资料目录锁。先验证来源，再为现有库另建快照，最后替换数据库。已有备份文件拒绝覆盖。校验涵盖 SQLite 完整性、外键、资料模式、正文 schema 和附件散列。损坏库应保留原目录，将有效快照恢复到新建的空目录，再修改配置。定期保留数份独立快照，至少有一份位于另一块磁盘。运行时 `-wal` 和 `-shm` 是事务辅助文件，运行期间应通过备份命令取快照。

旧资料目录、程序、配置、现有备份和地图资料分别管理。V9 测试使用新建的隔离数据库，现有正式实例无需更改。
