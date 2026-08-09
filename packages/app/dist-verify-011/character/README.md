# 姜晓角色动效素材目录

10 个状态透明背景动画素材，由 `scripts/chroma_key_green.py` 对 `docs/video/` 下绿底 mp4 抠绿生成。

## 素材清单

| 文件名 | 状态 | 触发 |
|--------|------|------|
| `idle.webp` | 待机 | 空闲等待输入 |
| `thinking.webp` | 思考 | 收到 prompt，AI 推理 |
| `thinking2.webp` | 思考·看书 | AI 推理（阅读上下文） |
| `replying.webp` | 回复 | AI 流式输出 |
| `working.webp` | 工作 | 工具执行（读/写/搜索/命令） |
| `error.webp` | 报错 | 出现错误 |
| `welcome.webp` | 欢迎 | 新会话/首次进入 |
| `complete.webp` | 完成 | 任务完成 |
| `permission.webp` | 权限 | 请求权限授权 |
| `waiting.webp` | 等待输入 | 等待用户操作 |

## 素材规范

- **格式**：WebP 动画（非 WebM），原生支持动画 + alpha 通道透明背景
- **尺寸**：9:16 竖版（664×1388）
- **帧率/时长**：15fps、75 帧/5 秒
- **循环**：首尾帧一致的无缝循环
- **大小**：每段约 9MB，10 段总计约 90MB
- **播放方式**：用 `<img>` 标签播放（WebP 动画，非 `<video>`）

## 生成工具

- **脚本**：`scripts/chroma_key_green.py`
- **输入**：`docs/video/` 下绿底 mp4（纯绿色底 RGB(0,255,0)，由 AI 视频生成）
- **处理**：ffmpeg chromakey 抠绿 → Pillow 合成 WebP 动画
- **输出**：本目录下 10 个 `.webp` 文件
- **重新生成**：`python scripts/chroma_key_green.py`（详见 `docs/tools.md` 中 `chroma_key_green.py` 条目）

## 格式说明

工单原定 WebM (VP9 + alpha)，但当前环境 ffmpeg 7.1 (gyan.dev essentials) 的 libvpx/libaom 编码器不支持 WebM alpha 通道编码。改用 WebP 动画（Pillow 生成，alpha 可靠，Chrome/Edge/Electron 完全支持，用 `<img>` 标签播放）。

## 备注

素材缺失时对应元素静默隐藏，不影响功能。
