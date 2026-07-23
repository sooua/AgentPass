# AgentPass 使用说明

给日常使用者的完整手册。从零接上,到每天怎么用,到出错怎么查。

> 英文版产品说明见 [README.md](README.md)。本文对应 **v2.1.0**。

---

## 目录

- [0. 它到底是什么](#0-它到底是什么)
- [1. 装好并接上](#1-装好并接上)
- [2. 加第一台机器](#2-加第一台机器)
- [3. 日常场景](#3-日常场景)
- [4. 改和删](#4-改和删)
- [5. 自己动手:拿 ssh 命令](#5-自己动手拿-ssh-命令)
- [6. 拿明文密码](#6-拿明文密码)
- [7. 查历史](#7-查历史)
- [8. 备份与换电脑](#8-备份与换电脑)
- [9. 出错了怎么查](#9-出错了怎么查)
- [10. 工具速查](#10-工具速查)
- [11. 边界:它不做什么](#11-边界它不做什么)

---

## 0. 它到底是什么

一个 MCP server。你把服务器的登录方式交给它,它加密存在本机;之后你**用人话**指挥 agent 去操作服务器,密码不会出现在对话里。

```
你说话  →  agent 调工具  →  agentpass 解密 → 系统 ssh 登录 → 擦掉临时文件
                                    ↓
                        ~/.agentpass/hosts.json（AES-256-GCM）
```

没有后台服务、没有网页、没有桌面应用。它只在 agent 运行时存在。

**你需要有:**

| 东西 | 为什么 | 怎么确认 |
|------|--------|----------|
| Node.js 22+ | 跑这个 MCP server | `node -v` |
| ssh 客户端 8.4+ | 真正登录的是它,不是我们 | `ssh -V` |
| Git Bash(仅 Windows) | 密码登录要靠 shell 脚本喂密码,Windows 自带的 `ssh.exe` 做不到 | `where bash` |

---

## 1. 装好并接上

### 1.1 构建

```bash
cd D:/dev/Owner/AgentPass
pnpm install
pnpm build
```

改过源码就要重新 `pnpm build` —— MCP 跑的是 `dist/`,不是 `src/`。

### 1.2 注册到 Claude Code

```bash
claude mcp add agentpass -s user -- node D:/dev/Owner/AgentPass/dist/index.js
```

- `-s user` 表示**所有项目**都能用。不加的话只在当前目录生效,换个项目就找不到了。
- 路径用**正斜杠**。`D:\dev\...` 里的反斜杠会被 shell 当转义吃掉。
- 路径要指到 `dist/index.js`,不是 `src/index.ts`。

### 1.3 重启并验证

退出 Claude Code 再进(MCP 只在启动时加载),然后:

```bash
claude mcp list
```

看到这行就成了:

```
agentpass: node D:/dev/Owner/AgentPass/dist/index.js - ✔ Connected
```

再对 agent 说一句确认:

> agentpass 里有哪些机器?

第一次会是空的。这正常 —— 库在你加第一台机器时才创建。

---

## 2. 加第一台机器

### 2.1 密码登录

直接说:

> 记一下我的服务器:23.238.1.51,用户 root,密码 你的密码,叫它 vps

agent 会调 `add_host`,返回:

```json
{
  "name": "vps",
  "host": "23.238.1.51",
  "user": "root",
  "port": 22,
  "auth": "password",
  "added_at": "2026-07-23T11:38:56.149Z"
}
```

**注意返回值里没有密码。** 存进去之后,除了 `get_secret`,没有任何工具会把它吐出来。

端口不是 22 就说出来:「…,端口 2222」。

### 2.2 私钥登录

> 加一台机器叫 build-box,10.0.0.7,用户 deploy,私钥在 C:/Users/sooua/.ssh/id_ed25519

agent 需要**私钥的内容**,不是路径 —— 让它先读文件再调 `add_host`,或者你直接把 PEM 贴给它。

⚠️ **带 passphrase 的私钥不支持。** ssh 会卡在等待输入直到超时。先解密:

```bash
ssh-keygen -p -f id_ed25519 -N ""
```

### 2.3 名字怎么起

- **大小写随便**。`vps`、`VPS`、`Vps` 都能找到同一台。
- **可以带空格**:`my vps`、`Crystal US VPS`。
- **短的好**。你每天都要说这个名字。
- ⚠️ **同名会直接覆盖,不提示。** 用一个已存在的名字加机器,旧的那台连同密码一起消失。加之前先 `list_hosts` 看一眼。

---

## 3. 日常场景

下面每一条都是直接对 agent 说的话。它会自己选 `run` 还是 `ssh_access`。

### 3.1 看一眼机器状态

> vps 现在怎么样?磁盘、内存、负载都看看

背后是一次 `run`,一次登录跑完:

```json
{
  "exit_code": 0,
  "stdout": "/dev/vda1  111G  50G  57G  47% /\n...",
  "stderr": "** WARNING: connection is not using a post-quantum key exchange algorithm..."
}
```

> **`stderr` 里的 post-quantum 警告是正常的**,不是错误。新版 OpenSSH 对不支持后量子密钥交换的服务器都会提醒。看 `exit_code` 判断成功与否,`0` 就是成功。

### 3.2 服务运维

> vps 上 nginx 还活着吗?死了就拉起来

> 把 vps 的 docker 容器列出来,看看有没有 exited 的

> 重启 vps 上的 mysql,重启完确认端口 3306 在听

### 3.3 看日志

> vps 的 /var/log/nginx/error.log 最后 100 行给我

⚠️ **单次输出超过 100 KB 会被截断**,但会明确告诉你:

```
…[agentpass] truncated, 2451233 more bytes
```

看到这行就说明你拿到的**不是全部**。改用 `grep`、`tail -n`、`awk` 在服务器上先筛,别把整个日志拉回来:

> 在 vps 上 grep 一下今天的 500 错误,只要最近 50 条

### 3.4 部署

> 到 vps 的 /srv/app 目录,git pull,然后 npm ci && npm run build,最后 pm2 restart app

一句话一次登录。要分步确认就分几句说,每句一次 `run`。

### 3.5 排障

> vps 上 8080 端口被谁占了?

> vps 磁盘满了吗?哪个目录最大?

> 看看 vps 最近有没有 OOM

### 3.6 传文件(暂时的变通)

**目前没有文件传输工具**(在计划里)。小文件用 heredoc 变通:

> 在 vps 上把这段内容写进 /etc/nginx/conf.d/app.conf:(贴内容)

大文件或二进制,先 `ssh_access` 拿命令,再自己用 `scp`。

### 3.7 慢命令

默认 60 秒超时,最多 600 秒。长任务要说明:

> 在 vps 上跑 apt update && apt upgrade -y,给它 10 分钟

更长的任务别硬等 —— 让它 `nohup` 起来,过会儿再查:

> 在 vps 上用 nohup 后台跑那个备份脚本,输出写到 /tmp/backup.log

---

## 4. 改和删

### 4.1 改名 / 改端口 / 改地址

> 把 Crystal US VPS 改名叫 vps

> vps 的 ssh 端口改成 2222

**不用重新给密码。** `update_host` 只改你提到的字段,其余原样保留。

### 4.2 换密码

服务器上改完密码后:

> vps 的密码改成 新密码

### 4.3 从密码换成密钥

必须同时给新密钥 —— 只说「改成密钥登录」会被拒绝:

```
changing auth type needs the new password or private key
```

这是故意的。否则库里会留下一个「密码存在密钥位置」的条目,之后每次登录都莫名其妙失败。

### 4.4 删

> 把 build-box 从 agentpass 里删掉

删的是**存储的凭据**,不是服务器。

---

## 5. 自己动手:拿 ssh 命令

想开个交互式会话、跑 `top`、用 `vim` 改文件:

> 给我一条连 vps 的 ssh 命令

拿到:

```bash
SSH_ASKPASS='C:/Users/sooua/.agentpass/access/8f3c…/askpass.sh' SSH_ASKPASS_REQUIRE=force ssh -F 'C:/Users/sooua/.agentpass/access/8f3c…/config' vps
```

**必须在 POSIX shell 里跑** —— Windows 上就是 Git Bash。PowerShell 和 cmd 不认这个语法,因为前面那两个是环境变量前缀。

默认 15 分钟后临时文件被擦除。**已经连上的会话不会断** —— 擦的是登录材料,不是连接。要长一点:

> 给我一条 ssh 命令,有效期一小时

---

## 6. 拿明文密码

要在 Xshell、FinalShell、数据库客户端里手动填的时候:

> 我要 vps 的密码,我要用 Xshell 连

agent 会调 `get_secret`,并且**必须给一个理由**,理由会写进审计日志。

⚠️ **明文一旦返回,就留在对话记录里了。** 它会进模型上下文、进你的 transcript。能用 `run` 或 `ssh_access` 就别用这个。

---

## 7. 查历史

每个动作一行,追加写进 `~/.agentpass/audit.jsonl`:

```json
{"ts":"2026-07-23T11:39:12.357Z","action":"run","host":"vps","command":"df -h /","exit_code":0}
{"ts":"2026-07-23T12:02:41.882Z","action":"get_secret","host":"vps","reason":"手动用 Xshell 连"}
```

**日志里永远没有密钥。** 目前没有读取工具(在计划里),自己看:

```bash
tail -20 ~/.agentpass/audit.jsonl
```

或者让 agent 读这个文件 —— 它是纯文本。

---

## 8. 备份与换电脑

库在这里:

```
~/.agentpass/
  hosts.json     你的机器,加密的
  master.key     解密它的钥匙,32 字节
  audit.jsonl    历史
  access/        当前登录的临时文件（通常是空的）
```

Windows 上是 `C:\Users\你\.agentpass\`。

### 🔴 两个文件缺一不可

`hosts.json` 没有 `master.key` **就是一堆乱码,没有任何办法恢复**。反过来也一样。

备份就是把这两个一起拷走,放到你放密码本的地方:

```bash
cp ~/.agentpass/hosts.json ~/.agentpass/master.key /path/to/backup/
```

### 换电脑

把整个 `~/.agentpass/` 目录拷过去,再在新机器上 `pnpm install && pnpm build` + `claude mcp add`。**2.0 没有同步功能**,这是有意的。

### 换个位置存

设 `AGENTPASS_HOME` 环境变量,库就去那儿:

```bash
AGENTPASS_HOME=D:/secure/agentpass node dist/index.js
```

---

## 9. 出错了怎么查

| 你看到的 | 原因 | 怎么办 |
|---|---|---|
| `claude mcp list` 里没有 agentpass | 没注册,或注册后没重启 | 重跑 `claude mcp add`,退出 Claude Code 再进 |
| `✘ Failed to connect` | `dist/index.js` 不存在或路径写错 | `pnpm build`;路径用正斜杠、指到 `dist/` |
| `no host named "x". Known: vps` | 名字不对 | 用它列出来的名字。大小写无所谓,错别字有所谓 |
| `exit_code: 255`,`Connection closed` | ssh 层面失败:机器关了、防火墙、端口不对 | 先 ping 一下;确认端口;`update_host` 改端口 |
| `exit_code: 255`,`Permission denied` | 密码或密钥不对 | 服务器上改过密码?`update_host` 更新 |
| 卡住直到超时 | 私钥带 passphrase(不支持),或者服务器在等交互输入 | 解密私钥;命令加 `-y` / `< /dev/null` |
| `could not start a shell to run ssh` | Windows 上找不到 Git Bash | 装 Git for Windows |
| `cannot decrypt "vps" — master.key does not match` | 主密钥被换/删了 | 有备份就拷回来。没有的话,**存的密钥彻底没了**,只能重新 `add_host` |
| 输出末尾 `…truncated, N more bytes` | 超过 100 KB | 在服务器端先筛(`grep`/`tail`),别整个拉回来 |
| `stderr` 里 post-quantum 警告 | 服务器 OpenSSH 版本旧 | 不是错误,忽略。看 `exit_code` |

看 agent 到底干了什么:`tail ~/.agentpass/audit.jsonl`。

---

## 10. 工具速查

agent 会自己选,这张表是给你排查用的。

| 工具 | 参数 | 说明 |
|---|---|---|
| `add_host` | `name`, `host`, `user`, `port?`(默认 22), `password?` \| `private_key?` | 密码和私钥**二选一**。同名会覆盖 |
| `list_hosts` | — | 不含密钥 |
| `update_host` | `name`, `new_name?`, `host?`, `user?`, `port?`, `password?` \| `private_key?` | 只改传了的字段 |
| `remove_host` | `name` | |
| `run` | `name`, `command`, `timeout_seconds?`(默认 60,最大 600) | 登录 → 执行 → 返回 → 擦除。输出上限 100 KB |
| `ssh_access` | `name`, `ttl_seconds?`(默认 900,最大 86400) | 返回命令,你自己跑 |
| `get_secret` | `name`, `reason`(必填) | 明文。会进对话记录 |

内部固定值:`ConnectTimeout 10`(连不上 10 秒放弃)、`StrictHostKeyChecking accept-new`(首次自动信任主机指纹)。

---

## 11. 边界:它不做什么

**它防的是:** 你的服务器密码漏进对话记录、shell 历史、模型上下文、聊天转录。

**它不防:**

- **已经登进你电脑的人。** `master.key` 就放在数据旁边,和你的 `~/.ssh/id_rsa` 一模一样。这是本机加密,不是保险箱。
- **agent 干的事本身。** `run` 给的是你服务器上的一个 shell,权限跟你一样大。事前拦住它的是 **Claude Code 自己的工具批准弹窗** —— 别习惯性全部放行。事后查它的是审计日志。
- **误操作。** 没有 dry-run、没有确认、没有回滚。`rm -rf` 说了就执行。

**没有的功能**(有意砍掉的):多用户、agent 分级令牌、审批流、密钥轮换、跨设备同步、桌面应用。需要这些的话用 [v1.0.3](https://github.com/sooua/AgentPass/releases/tag/v1.0.3),它还在,而且能装。

**还没做的**(在计划里):文件传输、审计查询工具、私钥 passphrase、导出备份。
