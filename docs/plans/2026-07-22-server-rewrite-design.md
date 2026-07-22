# FontInAss-Local 服务端完全重写 — 设计与实施记录

- 日期：2026-07-22
- 状态：已完成；v2 已部署并通过部署满 10 分钟最终确认
- 范围：`server/` 完全重写、`web/` 接新契约、数据离线重建、Docker 切换
- 原则：不保留旧服务实现、不提供双栈兼容层；旧数据库与旧镜像只作为回滚资产

## 1. 结论

原方案的 greenfield rewrite 方向正确，但实施前修正了四个逻辑问题：

1. R2 中只有字幕包 blob，没有逐对象 `metadata.json`，因此不能只扫描对象路径重建完整分享元数据。
2. Rust CLI 与 Web 都依赖 `/api/subset` 的二进制/批量传输；把该 wire protocol 定义为 v2 正式协议，而不是另造 JSON 包装或保留兼容层。
3. `Schema.parse()` 本身不会产生 Hono RPC 输入类型；JSON 路由使用 Zod validator，路由链导出 `AppType`。
4. 按 `contracts/domain/adapters/routes` 横向搬运会导致长时间无法集成；实际按可运行的纵向切片实施。

## 2. 最终架构

```text
packages/
  contracts/             wire DTO、Zod schema、响应 CODE
  subtitle-processing/   ASS/SSA/SRT、字体子集化、深接口 process()
  font-catalog/          字体匹配、索引、扫描、上传、去重
  archive-library/       分享库、审核、manifest、包检查
  access-control/        upload token 与审计接口
  activity-log/          处理记录与缺失字体
  persistence/           SQLite v2 adapters
  storage/               FS 字体、FS pending、R2 published adapters
server/
  src/container.ts       唯一组合根
  src/app.ts             Hono 路由与 AppType
  src/runtime.ts         环境配置、日志、master key 比较
  src/index.ts           启动与关闭
web/
  src/api/client.ts      Hono RPC + 二进制/文件 adapter
```

没有建立“大而全”的 `domain/` 或集中式 `ports/`。每个模块拥有自己的接口：

- `FontCatalog` 拥有 `FontCatalogRepository`、`FontFileStore`、`FontInspector`。
- `DefaultSubtitleProcessor` 只暴露 `process()`，字体加载/匹配是内部 seam。
- `DefaultArchiveLibrary` 拥有 repository、published store、pending store、inspector。
- token 与活动记录是独立模块，不再塞入字体或分享模块。

## 3. 依赖纪律

- 领域模块不 import Hono、`bun:sqlite`、环境变量或全局 config。
- `contracts` 只描述 wire 数据，不承载领域实体或 repository。
- `persistence` 实现各领域模块拥有的 repository 接口。
- `storage` 分别实现 FS 与 R2 的真实接口；没有把两种语义硬塞进同一通用 Storage。
- 所有生产 adapter 只在 `server/src/container.ts` 创建。

## 4. 字幕处理接口

外部接口保持足够深：

```ts
interface SubtitleProcessor {
  process(input: {
    filename: string;
    bytes: Uint8Array;
    options?: Partial<SubsetOptions>;
  }): Promise<SubsetResult>;
}
```

ASS/SRT 解析、已嵌入字体处理、旧 subset alias 恢复、字体匹配、按文件/face 分组、opentype 子集化、竖排表保留、UUencode 和 `[Fonts]` 回填全部隐藏在该接口后面。

## 5. 正式传输契约

### JSON

- Zod schema 定义请求与 wire DTO。
- Hono `zValidator` 在入口校验。
- `server/src/app.ts` 导出 `AppType`。
- Web 使用 `hc<AppType>()`，删除原 851 行手写类型同步。

### 文件与二进制

Hono RPC 不适合假装所有请求都是 JSON，因此保留小型 adapter：

- 单字幕：二进制 body；`X-Code`、`X-Message`；二进制响应。
- 批量字幕：multipart；JSON/base64 响应。
- 字体/字幕包上传：multipart。
- 字体/字幕包下载：blob/stream。
- R2 下载：302 redirect。

这套 `/api/subset` 协议是 v2 正式协议，Rust CLI 无需保留另一条兼容路径。

## 6. 数据设计与重建

### 字体

- 源头：`./fonts/`。
- 新数据库：`data/fontinass-v2.db`。
- 不读取或迁移旧字体索引表。
- 离线扫描 30,718 个字体文件，耗时 267 秒。
- 结果：30,718 files、32,757 faces、107,253 names、0 个无名称条目。
- `PRAGMA integrity_check`：`ok`。

### 分享库

R2 对象路径无法表达字幕组、语言、字体标记、集数、sub entries 和历史时间。一次性从旧数据库导出：

```text
_catalog/archive-manifest-v1.json
```

manifest 已写入 R2，共 179 条 published 元数据。v2 首次启动在本地分享表为空时读取 manifest；之后所有发布、批准、编辑、删除都会同步重写 manifest。

### 明确不迁移

- API upload token：上线后重新签发。
- 处理日志、缺失字体 resolved 状态、rate-limit 计数、内存 cache。
- 旧 DB schema 与迁移脚本。

## 7. 删除与合并

- 删除 AnimeSub `import-index` 服务端、Web UI 和 i18n。
- 删除 `repair-keys` 服务端与 Web UI。
- `upload-to-existing` 合并进正式发布端点。
- 删除旧 `server/src/{lib,routes,db.ts,storage.ts,cache.ts,config.ts}`。

最终由 43 个旧端点收敛为 40 个正式端点，详见 [端点清单](./2026-07-22-server-rewrite-endpoint-ledger.md)。

## 8. 构建与测试

真实根脚本：

```text
bun run typecheck
bun run test
bun run build
bun run check
```

已验证：

- 全 workspace TypeScript/Vue typecheck。
- opentype 竖排表回归测试。
- 字体 weight suffix / exact match 测试。
- Vite 生产构建。
- Bun 服务端 bundle。
- Docker workspace frozen-lockfile 构建。
- 临时 DB 下真实字体上传与 ASS 子集化。
- 临时 DB 下分享投稿、预览、驳回。
- 临时 DB 下 token 签发、程序上传、whoami。

字体二进制不要求逐字节一致；验收比较协议 CODE、缺失字体语义、`[Fonts]`/`[Events]` 完整性和可解析输出。

## 9. Docker 与发布

- Docker builder 复制根 workspace、`packages/*` 和 `bun.lock`。
- 前端与服务端在镜像中实际构建。
- runtime 只复制 bundle 和 Web dist，并安装 7z。
- `DB_PATH` 切换到 `/app/data/fontinass-v2.db`。
- rebuild 脚本先构建后 recreate，避免构建期间停机，并等待 `version: 2` health contract。

回滚资产：

- 旧 `data/fonts.db` 未修改。
- 旧镜像标记为 `fontinass-local:pre-v2-20260722`。
- R2 原 blob 未移动或改名，只新增 `_catalog` manifest。

## 10. 上线证据

- 最终镜像：`sha256:d843c91c76c407074a5a934ef4c7e3b92617645be30387a3bb71a109fa08e35b`。
- 最终容器启动时间：2026-07-22 12:16:08（Asia/Shanghai）。
- `/api/health`：HTTP 200，`{ "status": "ok", "version": 2 }`。
- 字体 API：30,718。
- 分享 API：179。
- 启动日志确认首次从 R2 manifest 恢复 179 条。
- 生产简单 ASS 冒烟：CODE 200，输出 12,413 bytes，包含 `[Fonts]` 与 `[Events]`。
- Rust CLI 真实 ASS 冒烟：生成约 165 MB 输出，处理 79 个字体变体；只有预期的缺失字形 warning，无处理失败。
- R2 key 严格按 RFC 3986 编码；包含 `!`、`'`、`(`、`)`、`*` 的 22 个已发布对象逐一 HEAD，全部返回 HTTP 200。

2026-07-22 12:26:46（部署后 10 分 38 秒）完成唯一一次最终确认：

- 容器 `healthy`，health failing streak 为 0，restart count 为 0，无 OOM 或进程退出。
- 首页 HTTP 200 且返回生产 HTML。
- 字体仍为 30,718，分享记录仍为 179。
- 已删除的 `repair-keys` 与 `import-index` 生产端点均返回 HTTP 404。
- 最近 10 分钟容器日志共 45 行，无 `ERROR`、`panic` 或 `fatal`。

## 11. 上传访问模块深化

后续重构将原本分散在 `TokenManager`、Hono 路由和 `FontCatalog.uploadByToken()` 中的行为收敛为两个深模块：

- `UploadAccess`：字幕组申请状态机、一次性申请凭证、管理员审核、领取、签发、验证、过期、软吊销、公开 IP 速率桶和凭证审计计数。
- `FontSubmission`：公开受限投稿与字幕组凭证投稿共享字体验证、SHA-256 去重、安全存储命名、结果归一化和受控并发；只有公开路径执行文件数、单文件、批次与频率限制。

网页 `/upload` 调用匿名受限的 `POST /api/upload`；审核后的字幕组凭证可进入 `/fonts` 查看、下载和后台上传字体，也可调用不受公开投稿策略约束的 `POST /api/v1/upload`。删除、索引维护和凭证审核仍只接受 Master key。SQLite 使用 `PRAGMA user_version` 执行版本化迁移，已发布 v2 表中的旧计数会迁入 `request_count`、`accepted_file_count` 和 `accepted_bytes`，上传历史在软吊销后继续保留。
