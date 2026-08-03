# 小程序 CI（miniprogram-ci）

用脚本代替开发者工具手动点「上传」「预览」，便于本地一键发版与接入 CI/CD。

## 一次性准备

**1. 下载上传私钥**

微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传 → 生成并下载代码上传密钥，同时把当前机器/CI 出口 IP 加入 IP 白名单。

**2. 放置私钥（不要放进仓库）**

推荐放在仓库外，例如 `~/.wechat/poem-cloud-private.key`，权限收紧：

```bash
chmod 600 ~/.wechat/poem-cloud-private.key
```

**3. 配置环境变量**

```bash
export MP_PRIVATE_KEY_PATH="$HOME/.wechat/poem-cloud-private.key"
```

## 常用命令

在 `poem-cloud-client/miniprogram` 目录下执行：

```bash
# 生成预览二维码（默认输出 .mp-ci/preview.jpg）
pnpm mp:preview

# 预览指定页面
pnpm mp:preview --page pages/feedback/index

# 预览带参数的页面
pnpm mp:preview --page pages/publication-detail/index --scene-query "id=123"

# 上传版本（version 缺省取 package.json 的 version）
pnpm mp:upload

# 上传指定版本号与备注
pnpm mp:upload --version 1.2.0 --desc "接入反馈接口"

# 指定 CI 机器人（1-30，用于区分不同流水线）
pnpm mp:upload --robot 3
```

上传成功后到微信后台「版本管理」提交审核。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `MP_PRIVATE_KEY_PATH` | 二选一 | 私钥文件路径，本地开发推荐 |
| `MP_PRIVATE_KEY` | 二选一 | 私钥内容，适合 CI Secret 注入；脚本会写入权限 0600 的临时文件并在退出时删除 |
| `MP_APPID` | 否 | 缺省读取 `project.config.json` 的 `appid` |
| `MP_ROBOT` | 否 | CI 机器人编号 1-30，缺省 1 |
| `MP_VERSION` | 否 | 版本号，缺省取 `package.json` 的 `version` |
| `MP_DESC` | 否 | 版本备注，缺省为当前时间 |
| `MP_PREVIEW_OUTPUT` | 否 | 预览二维码输出路径，缺省 `.mp-ci/preview.jpg` |
| `MP_SKIP_URL_CHECK` | 否 | 设为 `1` 时跳过合法域名/TLS/证书校验，仅用于域名未就绪时的体验版调试 |

命令行参数（`--version` / `--desc` / `--robot` / `--output`）优先级高于环境变量。

## 域名未备案时如何发体验版

微信的域名校验规则：

| 场景 | 是否校验合法域名 | 能否用 HTTP / IP |
| --- | --- | --- |
| 开发者工具（勾选不校验） | 跳过 | 可以 |
| 体验版 **+ 手机「打开调试」** | 跳过 | 可以 |
| 体验版（未打开调试） | 校验 | 不行 |
| 正式版 | 强制校验，无法跳过 | 不行 |

所以域名/备案没就绪时，仍然可以发体验版联调：

```bash
MP_SKIP_URL_CHECK=1 pnpm mp:upload --desc "体验版联调"
```

然后在手机上：打开小程序 → 右上角 `···` → **打开调试** → 小程序重启后即可正常请求测试环境。

注意两点：

- 后端地址必须是**手机能访问到的地址**。`127.0.0.1` 或 `9.x` 内网 IP 手机连不上，需换成局域网 IP（同 WiFi）或公网可达地址。
- **发布正式版时务必不要带 `MP_SKIP_URL_CHECK`**，且后端必须是已备案的 HTTPS 域名，否则审核不通过。

## CI 接入示例

以 GitHub Actions 为例，把私钥内容存为仓库 Secret `MP_PRIVATE_KEY`：

```yaml
- name: 上传小程序
  working-directory: poem-cloud-client/miniprogram
  env:
    MP_PRIVATE_KEY: ${{ secrets.MP_PRIVATE_KEY }}
    MP_ROBOT: '2'
  run: |
    pnpm install --frozen-lockfile
    pnpm mp:upload --version "${{ github.ref_name }}" --desc "CI 自动上传 ${{ github.sha }}"
```

注意 CI 机器的出口 IP 也要加入微信后台白名单，否则会报 IP 不在白名单。

## 安全约定

- 私钥**只**通过环境变量提供，任何情况下不提交进仓库
- `.gitignore` 已忽略 `.mp-ci/`、`*.key`、`private.*.key`
- 私钥泄露时立即到微信后台重置代码上传密钥

## 注意事项

- 上传前确认 `miniprogram/config/api.ts` 的后端地址已指向正式环境（微信要求线上版本必须使用已备案的 HTTPS 域名）
- 若项目使用了 npm 包（`miniprogram_npm`），构建 npm 后再上传
- `robot` 编号相同的上传会互相覆盖同名版本，多条流水线建议各用一个编号
- `miniprogram-ci` 可能在当前目录留下 32 位十六进制名称的 Summer 编译缓存目录；上传或预览结束时脚本会自动清理本次缓存及历史遗留的同形态空目录
