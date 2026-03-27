# FontInAss

<p align="center">
  <strong>开源字幕字体子集化服务</strong><br>
  上传 ASS / SSA / SRT 字幕，自动匹配字体并嵌入精简子集，体积减少 95%+
</p>

<p align="center">
  <a href="https://font.anibt.net">🌐 在线服务</a> ·
  <a href="#cli-工具">💻 CLI 工具</a> ·
  <a href="#docker-部署">🐳 Docker 部署</a> ·
  <a href="https://t.me/nagasaki_sc">📢 Telegram</a>
</p>

---

## ✨ 功能特性

- **精准子集化** — 仅提取字幕实际使用的字符，字体体积减少 95% 以上
- **在线字体库** — 收录数万款中日韩及西文字体，自动匹配字幕中引用的字体
- **批量处理** — 支持一次处理 100+ 字幕文件，无数量限制
- **多格式支持** — ASS / SSA / SRT 字幕格式
- **CLI 工具** — 跨平台命令行工具，本地批量处理字幕
- **字幕分享** — 浏览和下载社区贡献的已处理字幕包
- **Web UI** — 现代化前端界面，拖拽上传，一键下载
- **Docker 部署** — 一键部署，开箱即用

## 🚀 快速开始

### Docker 部署（推荐）

```bash
git clone git@github.com:Yuri-NagaSaki/FontInAss.git
cd FontInAss

# 创建字体和数据目录
mkdir -p fonts data

# 配置环境变量
cp .env.example .env
# 编辑 .env，设置 API_KEY

# 构建并启动
docker compose up -d
```

访问 `http://localhost:3300`，进入字体管理页面点击 **扫描并索引** 建立字体索引。

### 手动部署

需要 [Bun](https://bun.sh) ≥ 1.1。

```bash
git clone git@github.com:Yuri-NagaSaki/FontInAss.git
cd FontInAss

# 安装依赖
bun install

# 构建前端
cd web && bun run build && cd ..

# 启动服务
bun run --cwd server src/index.ts
```

访问 `http://localhost:3000`。

### 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务器端口 |
| `API_KEY` | _(空)_ | 字体管理鉴权密钥 |
| `FONT_DIR` | `./fonts` | 字体存储目录 |
| `DB_PATH` | `./data/fonts.db` | SQLite 数据库路径 |
| `SUBSET_CONCURRENCY` | `5` | 并发子集化数量 |
| `LOG_LEVEL` | `info` | 日志级别 |

## 💻 CLI 工具

跨平台命令行工具 `fontinass`，通过 FontInAss 服务 API 在本地处理字幕文件。

### 安装

从 [GitHub Releases](https://github.com/Yuri-NagaSaki/FontInAss/releases) 下载对应平台的二进制文件：

| 平台 | 文件 |
|------|------|
| Linux x64 | `fontinass-linux-x64` |
| macOS x64 | `fontinass-macos-x64` |
| macOS ARM | `fontinass-macos-arm64` |
| Windows x64 | `fontinass-windows-x64.exe` |

```bash
# Linux / macOS
chmod +x fontinass-linux-x64
sudo mv fontinass-linux-x64 /usr/local/bin/fontinass
```

### 使用

```bash
# 配置服务器（仅需一次）
fontinass config set server https://font.anibt.net

# 处理单个文件
fontinass subset file.ass

# 批量处理
fontinass subset *.ass

# 递归处理目录
fontinass subset -r ./subs/

# 输出到指定目录
fontinass subset -o ./output/ *.ass

# 严格模式（缺字体时报错）
fontinass subset --strict file.ass
```

详细文档见 [cli/README.md](cli/README.md)。

## 📡 API

子集化接口公开，字体管理接口需 `X-API-Key` 请求头。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/subset` | 字幕子集化（公开） |
| `GET` | `/api/fonts` | 列出已索引字体 |
| `POST` | `/api/fonts/scan-local` | 扫描并索引字体目录 |
| `GET` | `/api/fonts/stats` | 索引统计 |
| `GET` | `/api/sharing/archives` | 字幕分享归档列表 |

## 🛠 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | [Bun](https://bun.sh) |
| 后端框架 | [Hono](https://hono.dev) |
| 数据库 | SQLite (bun:sqlite) |
| 字体处理 | [opentype.js](https://opentype.js.org) |
| 前端 | [Vue 3](https://vuejs.org) + [Tailwind CSS v4](https://tailwindcss.com) |
| CLI | [Rust](https://www.rust-lang.org) + [clap](https://docs.rs/clap) |
| 部署 | Docker |

## 📄 License

MIT
