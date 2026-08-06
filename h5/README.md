# 诗云 H5

React + TypeScript + Vite 的移动端 SPA，与微信小程序共用后端业务接口和视觉资产。

## 本地运行

```bash
pnpm install
pnpm dev
```

默认地址为 `http://localhost:5173`。本地开发时，Vite 会把 `/api` 代理到
`http://127.0.0.1:3000`；也可以在 `.env.local` 中配置完整后端地址：

```bash
VITE_API_BASE_URL=https://api.example.com/v1
```

本地 COS 直传通过 `VITE_COS_PROXY_TARGET` 走 Vite 的 `/cos-upload` 同源代理，避免
localhost 被 Bucket CORS 拦截。生产部署仍需要在 COS Bucket 配置正式 H5 Origin 的
`PUT`/`OPTIONS` CORS 规则。

## 检查与构建

```bash
pnpm typecheck
pnpm build
```

## 登录接口约定

登录页已经支持手机号与邮箱两种交互方式。验证码服务接入后，前端会调用：

```http
POST /v1/auth/verification-code/login
Content-Type: application/json

{
  "channel": "PHONE | EMAIL",
  "account": "手机号或邮箱",
  "code": "验证码"
}
```

成功响应沿用现有微信登录结构：

```json
{
  "data": {
    "user": {},
    "accessToken": "ps_...",
    "expiresAt": "2026-09-01T00:00:00.000Z"
  }
}
```

当前点击“获取验证码”会展示待接入提示。服务端配置 `H5_UNIVERSAL_VERIFICATION_CODE`
后，可用该万能验证码完成手机号或邮箱登录；未配置时表单会明确提示服务尚未配置。

微信好友分享等依赖微信客户端的能力目前只保留与小程序一致的按钮和状态，点击时提示待接入；后续统一通过微信 JSSDK 实现，不使用浏览器 Web Share API 冒充微信能力。

## 页面

- `/create` 创作
- `/creation-preferences` 首次创作偏好问卷
- `/creating/:runId` 创作进度与结果
- `/community` 诗词圈
- `/publication/:id` 作品详情、创作手记、点赞与评论
- `/profile` 我的
- `/works`、`/drafts`、`/followers`、`/following`
- `/preferences`、`/edit-profile`
- `/help`、`/feedback`、`/about`
- `/login` 手机号或邮箱验证码登录
