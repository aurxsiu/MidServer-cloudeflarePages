## mid-server（Cloudflare Pages + KV）

这是一个**无页面**的中转服务：电脑 A 发起请求写入 KV；电脑 B（只有 1 台）轮询拉取请求、处理后回传；A 再轮询取回结果。全流程仅需 `curl`。

### 端点

- **GET/POST** `/rpc`：A -> **单次请求等待结果**（不轮询）。成功返回 `200` + 二进制响应体；超时返回 `504`（默认等待 25s，可用 `wait_ms` 调整，最高 29s）
- **POST** `/send`：A -> 写入请求体，返回 `{ seq }`。如果忙返回 `409`
- **GET** `/poll`：B -> 拉取待处理请求体（返回二进制），并在 header 返回 `X-Seq`
- **POST** `/reply?seq=...`：B -> 回传响应体（任意二进制）
- **GET** `/result?seq=...`：A -> 轮询结果；未就绪返回 `202`；就绪返回 `200` + 二进制响应体
- **GET** `/health`：查看通道状态（调试用）

默认通道是 `default`。如需多通道可加 `?channel=xxx`（A/B 两端必须一致）。

### 部署到 Cloudflare Pages（必须）

1. 在 Cloudflare Dashboard 创建一个 **KV Namespace**（Workers KV）。
2. 打开本仓库的 `wrangler.toml`，确认 `[[kv_namespaces]]` 的 `id` 是你的 KV Namespace ID。
3. 在 Cloudflare Pages 新建项目并部署本仓库（Functions 会自动生效）。
   - **Build command**：留空（或 `npm run build`，本项目不需要构建）
   - **Build output directory**：`public`

> 你贴的日志里出现了 `Executing user deploy command: npx wrangler deploy`，这说明你在 Cloudflare 后台配置了“Deploy command”（或创建成了 Workers 项目）。
> **Pages 正常不需要也不应该运行 `wrangler deploy`**，请把 deploy command 清空，让 Pages 自己发布。

### 如果你当前后台强制跑的是 `npx wrangler deploy`

我已经在 `wrangler.toml` 加了 `main = "src/index.ts"`，并提供了 `src/index.ts`，这样即使后台仍然跑 `wrangler deploy` 也不会再报 “Missing entry-point”。

### 本地开发（可选）

需要安装 Node.js。

```bash
npm i
npm run dev
```

默认会起一个本地服务地址（wrangler 输出中会显示），用下面的 curl 把 `BASE` 换成对应地址。

### Curl：电脑 A

```bash
BASE="https://YOUR-PAGES-DOMAIN"

# 方式 1：POST（推荐，可传任意二进制）
echo -n "hello from A" > request.bin
curl -s -o result.bin -X POST "$BASE/rpc?wait_ms=25000" --data-binary @request.bin
echo "Got response -> result.bin"

# 方式 2：GET（只适合文本；用 data= 传参）
# curl -s -o result.bin "$BASE/rpc?data=hello%20from%20A&wait_ms=25000"
```

### Curl：电脑 B（轮询 + 回传）

```bash
BASE="https://YOUR-PAGES-DOMAIN"

while true; do
  HTTP_STATUS=$(curl -s -D headers.txt -o req_from_A.bin -w "%{http_code}" "$BASE/poll")

  if [ "$HTTP_STATUS" = "200" ]; then
    SEQ=$(grep -i "^X-Seq:" headers.txt | awk '{print $2}' | tr -d '\r')
    echo "Got request seq=$SEQ"

    # TODO：在这里处理 req_from_A.bin，生成 resp_to_A.bin
    # 示例：原样回显
    cp req_from_A.bin resp_to_A.bin

    curl -s -X POST "$BASE/reply?seq=$SEQ" --data-binary @resp_to_A.bin > /dev/null
  elif [ "$HTTP_STATUS" = "204" ]; then
    sleep 1
  else
    echo "Poll error http=$HTTP_STATUS"
    sleep 2
  fi
done
```

### 重要说明

- **单并发**：同时只能处理 1 个 A 请求（因为只有 1 台 B）。A 端如果遇到 `409 busy` 需要稍后重试。
- **TTL 防卡死**：请求/响应在 KV 中默认 10 分钟过期，避免 B 掉线导致无限占用。

