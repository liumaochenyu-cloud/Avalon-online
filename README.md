# 联机无上帝阿瓦隆原型

这是一个 Node 静态服务 + HTTP API + Server-Sent Events 的联机原型。

核心能力：

- 房主创建房间，得到房间号和邀请链接。
- 玩家用 `?room=房间号` 或手动输入房间号加入。
- 每个玩家设置昵称、emoji 头像或图片 URL 头像。
- 服务端随机分配身份，但客户端只收到自己的身份和自己应知道的信息。
- 当前队长在自己的设备上提名任务队伍。
- 所有玩家在自己的设备上投赞成或反对。
- 上队玩家在自己的设备上提交任务牌；好人只能成功，坏人可以成功或失败。
- 每轮任务结束后只公布打乱后的公开牌面，例如 `✅ ✅ ❌`。
- 游戏中不会公开谁出了哪张任务牌；游戏结束后复盘会显示上队玩家各自提交的 `✅` / `❌`。
- 7 人及以上第 4 轮按特殊轮处理，需要 2 张 `❌` 才失败。
- 如果本局有梅林和刺客，好人三次任务成功后会进入刺杀梅林阶段；只有刺客设备能选择目标。
- 刺杀完成或坏人三次任务失败后，公布所有玩家身份和完整任务记录。
- 大厅和终局允许玩家离开，房主也可以移出玩家；游戏进行中不允许加入、退出或踢人。

## 本地运行

```powershell
cd C:\Users\Lin\Documents\Codex\2026-07-02\new-chat\outputs\avalon-online-prototype
npm run build
npm start
```

如果本机没有全局 `npm`，也可以直接用 Node：

```powershell
node server.mjs
```

然后打开：

```text
http://127.0.0.1:4177
```

同一 Wi-Fi 下手机加入时，使用电脑的局域网 IP，例如：

```text
http://192.168.48.100:4177
```

## 公网部署检查

- 前端 HTTP API 默认使用同源路径，例如 `/api/rooms`。
- 前端 SSE 默认使用同源路径，例如 `/events/:roomCode`。
- 如果前后端分开部署，可以设置：
  - `VITE_API_URL`
  - `VITE_SOCKET_URL`
- 服务端会通过 `/env.js` 把这两个变量注入到前端。
- 如果不设置环境变量，前端会使用 `window.location.origin` 所在的同源后端。
- 当前项目不是 Vite SPA，而是 Node 服务直接托管 `public/`，所以不需要 `vercel.json` 的 SPA rewrite。
- 房间当前保存在服务端内存中：刷新页面不会丢失房间状态，但服务器重启会丢失房间。正式部署建议接 Redis/Postgres/Supabase。

## 临时公网部署

今晚临时给朋友玩，可以保持本地服务运行，然后另开一个终端：

```powershell
cloudflared tunnel --url http://127.0.0.1:4177
```

把 cloudflared 输出的 `https://...trycloudflare.com` 链接发到微信群即可。通过公网链接进入时，复制邀请会优先使用当前公网域名。
