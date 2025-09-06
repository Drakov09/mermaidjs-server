
# Mermaid 转换服务

高性能 Mermaid 在线转换服务，使用 Node.js (Express) 提供将 Mermaid 图定义转换为 SVG 或 PNG 的接口。内置文件系统缓存、参数规范化、性能诊断响应头，并最小化浏览器 (Puppeteer) 使用：只在首次生成某图的 SVG 时启动一次。PNG 由 `sharp` 直接栅格化缓存的 SVG，避免高资源开销的浏览器截图。

现在也支持：

* WebSocket 实时渲染：路径 `/ws`，消息 `{type:"render", mermaid, theme, backgroundColor, width, height, format}` 返回 `{type:"render-result", ...}`。
* 前端演示页面：`/demo/index.html`（自动适配 `CONTEXT_PATH`）。页面包含：代码编辑、客户端（仅浏览器 mermaid）预览、服务端渲染结果与耗时/缓存命中信息。

## 特性

* ✅ Mermaid → SVG / PNG（GET & POST）
* ✅ GET 使用 base64 编码 `mmd` 参数（安全、无特殊字符问题）
* ✅ PNG 支持二进制或 JSON+base64 返回
* ✅ 缓存：同图 & 参数命中直接输出；PNG 基于缓存 SVG 生成
* ✅ 仅按需渲染，不做多余双格式预生成
* ✅ 浏览器只负责 SVG；PNG 由 sharp 完成（更轻）
* ✅ 浏览器空闲自动关闭（可配置）
* ✅ DELETE /cache/{cacheKey} 精确删除缓存
* ✅ 诊断头 `X-Mermaid-*` 提供性能可观测性
* ✅ 全部行为可由环境变量控制
* ✅ 多阶段 Docker 构建，启动快
* ✅ 健康检查 & 缓存统计接口
* ✅ CORS & 请求大小限制

## 接口概览

| 方法   | 路径              | 说明                        |
| ------ | ----------------- | --------------------------- |
| GET    | /                 | 自描述 JSON                 |
| GET    | /health           | 健康状态                    |
| GET    | /svg              | base64 mmd → SVG           |
| GET    | /png              | base64 mmd → PNG           |
| POST   | /convert/svg      | JSON → SVG                 |
| POST   | /convert/png      | JSON → PNG（可 base64）    |
| GET    | /cache/stats      | 缓存统计                    |
| DELETE | /cache            | 清空缓存                    |
| DELETE | /cache/{cacheKey} | 删除单条缓存                |
| WS     | /ws               | WebSocket 渲染（JSON 协议） |
| GET    | /demo/index.html  | 演示页面                    |

若配置 `CONTEXT_PATH`（例如 `/api/mermaid`），上述路径自动加前缀。

## 参数说明

GET /svg 与 /png 公共 query：

| 参数  | 含义                         | 必填 |
| ----- | ---------------------------- | ---- |
| mmd   | base64 Mermaid 文本          | 是   |
| theme | default/dark/forest/neutral  | 否   |
| bg    | 背景：white/transparent/#hex | 否   |
| w     | 宽度                         | 否   |
| h     | 高度                         | 否   |

POST /convert/svg 与 /convert/png 请求体字段：`mermaid`, `theme`, `backgroundColor`, `width`, `height`, 以及（仅 PNG）`format`。

`format = "base64"` 时返回 JSON；否则返回二进制图片。

## 示例：POST /convert/png 请求体

```json
{
  "mermaid": "graph TD\nA-->B",
  "theme": "dark",
  "backgroundColor": "transparent",
  "format": "base64"
}
```

## 响应诊断头

| Header                            | 含义                               |
| --------------------------------- | ---------------------------------- |
| X-Mermaid-Cache                   | HIT / HIT-SVG / MISS               |
| X-Mermaid-Cache-Key               | 缓存键（SHA256）                   |
| X-Mermaid-Source                  | cache / cache-svg-rasterized / api |
| X-Mermaid-Render-Time-ms          | 生成 SVG 耗时                      |
| X-Mermaid-Rasterize-Time-ms       | SVG→PNG (sharp) 耗时              |
| X-Mermaid-Cache-Lookup-ms         | 缓存查询耗时                       |
| X-Mermaid-Total-Time-ms           | 总耗时                             |
| X-Mermaid-Params                  | 规范参数 JSON                      |
| X-Mermaid-Browser-Startup-Time-ms | 浏览器首次启动耗时                 |
| X-Mermaid-Browser-Reused          | 是否复用浏览器                     |
| X-Mermaid-Browser-Fallback        | 预留（当前为空）                   |

## 渲染架构说明

1. 使用 `@mermaid-js/mermaid-cli`（内部 Puppeteer）生成 SVG 或直接生成 PNG（当首次请求就是 PNG 时，直接生成 PNG，不先生成 SVG）。
2. 如果先生成的是 SVG，再请求 PNG 时会使用 `sharp` 将缓存的 SVG 栅格化为 PNG（避免额外浏览器渲染）。
3. 两种策略合并：保证 PNG 首次请求只渲染一次；后续格式互转尽量不重复浏览器操作。
4. 重复请求直接命中缓存或本地快速转换。

## 安装与运行

本地：

```bash
npm install
npm start
```

开发模式：

```bash
npm run dev
```

Docker：

```bash
docker build -t mermaidjs-server .
docker run -p 8080:8080 -e CONTEXT_PATH=/mermaid mermaidjs-server
```

多平台：

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t yourrepo/mermaidjs-server:latest --push .
```

Docker Hub 直接拉取运行：

```bash
# 拉取最新版本 (假设已推送到命名空间 lihongjie0209)
docker pull lihongjie0209/mermaidjs-server:latest

# 指定版本 (例如 v1.2.3 打 tag 后产生的 1.2.3 语义版本标签)
docker pull lihongjie0209/mermaidjs-server:1.2.3

# 运行（默认 8080 端口）
docker run -d --name mermaid -p 8080:8080 \
  -e CACHE_TTL=604800000 \
  -e BROWSER_IDLE_MAX_MS=60000 \
  lihongjie0209/mermaidjs-server:latest

# 访问
curl http://localhost:8080/health

# 渲染一个示例 PNG (GET base64)
ENC=$(printf 'graph TD\nA-->B' | base64 -w0); \
curl "http://localhost:8080/png?mmd=$ENC" -o test.png

# POST 方式 (SVG)
curl -X POST http://localhost:8080/convert/svg -H 'Content-Type: application/json' \
  -d '{"mermaid":"graph TD\\nA-->B"}' -o test.svg
```

## 使用示例

HTML：

```html
<img src="http://localhost:8080/png?mmd=${btoa('graph TD\\nA-->B')}" />
```

curl：

```bash
# SVG
curl -X POST http://localhost:8080/convert/svg -H "Content-Type: application/json" -d '{"mermaid":"graph TD\\nA-->B"}' -o d.svg

# PNG (base64 mmd)
ENC=$(printf 'graph TD\nA-->B' | base64 -w0)
curl "http://localhost:8080/png?mmd=$ENC&theme=forest" -o d.png

# PNG (JSON base64)
curl -X POST http://localhost:8080/convert/png -H "Content-Type: application/json" -d '{"mermaid":"graph TD\\nA-->B","format":"base64"}'
```

Node.js：

```javascript
async function toPngBase64(code){
  const r=await fetch('http://localhost:8080/convert/png',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mermaid:code,format:'base64'})});
  return (await r.json()).data;
}
```

Python：

```python
import base64,requests
resp=requests.post('http://localhost:8080/convert/png',json={"mermaid":"graph TD\nA-->B","format":"base64"})
open('d.png','wb').write(base64.b64decode(resp.json()['data']))
```

## 环境变量

| 变量                  | 说明                    | 默认     |
| --------------------- | ----------------------- | -------- |
| PORT                  | 端口                    | 8080     |
| CONTEXT_PATH          | 路由前缀                | /        |
| CACHE_ENABLED         | 启用缓存                | true     |
| CACHE_DIR             | 缓存目录                | ./cache  |
| CACHE_TTL             | 缓存 TTL (ms)           | 86400000 |
| TEMP_DIR              | 临时目录                | ./temp   |
| MAX_REQUEST_SIZE      | 请求体限制              | 10mb     |
| DEFAULT_THEME         | 默认主题                | default  |
| DEFAULT_BACKGROUND    | 默认背景                | white    |
| DEFAULT_WIDTH         | 默认宽度                | 800      |
| DEFAULT_HEIGHT        | 默认高度                | 600      |
| BROWSER_TIMEOUT       | 浏览器启动/页面超时     | 30000    |
| ENABLE_BROWSER_CACHE  | 返回浏览器缓存头        | true     |
| BROWSER_IDLE_MAX_MS   | 浏览器空闲关闭 (0=不关) | 300000   |
| BROWSER_HEADLESS_MODE | 无头模式                | new      |
| WS_IDLE_CLOSE_MS      | WS 空闲关闭阈值 (ms)    | 120000   |
| WS_PING_INTERVAL_MS   | WS 心跳发送间隔 (ms)    | 30000    |

## 缓存策略

* 进程结束不自动清空。
* 可通过接口精确/整体清理。
* 推荐挂载 `CACHE_DIR` 以持久化。

## 错误

| 状态码 | 描述                       |
| ------ | -------------------------- |
| 400    | 缺少参数（如 mermaid/mmd） |
| 500    | 渲染或内部错误             |

示例：

```json
{"error":"Mermaid diagram text is required"}
```

## GET 参数编码

```bash
RAW='graph TD\nA-->B'
ENC=$(printf "%s" "$RAW" | base64 -w0)
curl "http://localhost:8080/svg?mmd=$ENC"
```

## 依赖

* Node.js 18+
* express / cors / fs-extra
* @mermaid-js/mermaid-cli
* puppeteer（首次生成对应格式：SVG 或直接 PNG）
* sharp（当已有 SVG 缓存并需要 PNG 时执行 SVG → PNG 栅格化）

## WebSocket 协议示例

发送：

```json
{"type":"render","mermaid":"graph TD\nA-->B","format":"png","theme":"dark"}
```

返回 (PNG)：

```json
{
  "type":"render-result",
  "format":"png",
  "pngBase64":"iVBORw0...",
  "cache":"MISS",
  "cacheKey":"<sha256>",
  "timings": {"render":12,"rasterize":0,"total":15}
}
```

返回 (SVG)：

```json
{
  "type":"render-result",
  "format":"svg",
  "svg":"<svg ...>",
  "cache":"MISS",
  "cacheKey":"<sha256>",
  "timings": {"render":10,"total":11}
}
```

## 许可证

MIT
