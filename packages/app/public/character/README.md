# 姜晓角色动效素材目录

10 个状态循环动画 + 36 个枢纽制过渡动画（透明背景），由 `scripts/chroma_key_green.py` 对 `docs/video/` 下绿底 mp4 抠绿生成。

## 循环素材清单

| 文件名 | 状态 | 触发 |
|--------|------|------|
| `idle.webp` | 待机 | 空闲等待输入 |
| `thinking.webp` | 思考 | 收到 prompt，AI 推理 |
| `reading.webp` | 思考·看书 | AI 推理（阅读上下文，原名 thinking2） |
| `replying.webp` | 回复 | AI 流式输出 |
| `working.webp` | 工作 | 工具执行（读/写/搜索/命令） |
| `error.webp` | 报错 | 出现错误 |
| `welcome.webp` | 欢迎 | 新会话/首次进入 |
| `done.webp` | 完成 | 任务完成（原名 complete） |
| `permission.webp` | 权限 | 请求权限授权 |
| `listening.webp` | 等待输入 | 等待用户操作（原名 waiting） |

## 过渡素材清单

枢纽制过渡（ADR-013 §2）：以待机为枢纽，任意状态 X 只需 `idle→X` 正放 + `X→idle` 倒放（`transition-<from>-<to>.webp` 命名，正放+倒放成对）。前端按 `TRANSITIONS` 表（`packages/app/src/components/character-transition.ts`）查路径播放。

- **核心 10 态链路**：`transition-idle-{thinking,reading,replying,working,error,welcome,done,permission,listening}.webp` 正放 + 对应 `transition-{...}-idle.webp` 倒放
- **直达链**：`transition-thinking-replying.webp` / `transition-replying-thinking.webp`
- **B 级扩展态段**（第二阶段接入 reducer，当前仅静态登记）：`transition-idle-{cheek-rest,chin-rest,frown-wave,nod-smile,shush,shy-smile}.webp` 正放 + 对应倒放；`transition-{frown-wave,nod-smile}-permission.webp` / `transition-permission-{frown-wave,nod-smile}.webp`

## 素材规范

- **格式**：WebP 动画（非 WebM），原生支持动画 + alpha 通道透明背景
- **尺寸**：9:16 竖版（720×1280 循环 / 722×1274 过渡）
- **帧率/时长**：15fps；循环段 75 帧/5 秒；过渡段 52 帧（≈3.5s）或 82 帧（≈5.5s，含 `--hold-tail` 尾帧静置 7 帧）
- **循环**：循环段首尾帧一致无缝循环（loop=0）；过渡段 loop=1 播一遍停尾帧
- **播放方式**：用 `<img>` 标签播放（WebP 动画，非 `<video>`）

## 生成工具

- **脚本**：`scripts/chroma_key_green.py`
- **输入**：`docs/video/` 下绿底 mp4（渐变绿底 RGB≈(14,196,61)，由 AI 视频生成；脚本默认 `--auto-color` 自动探测基准色）
- **处理**：ffmpeg chromakey 抠绿 → Pillow 合成 WebP 动画
- **输出**：本目录下 10 个循环 `.webp` + 36 个过渡 `.webp`
- **备份**：覆盖前旧文件备份到 `.scratch/character-hub-transitions/webp-backup-prev/`
- **重新生成**：`python scripts/chroma_key_green.py`（详见 `docs/tools.md` 中 `chroma_key_green.py` 条目）

## 格式说明

工单原定 WebM (VP9 + alpha)，但当前环境 ffmpeg 7.1 (gyan.dev essentials) 的 libvpx/libaom 编码器不支持 WebM alpha 通道编码。改用 WebP 动画（Pillow 生成，alpha 可靠，Chrome/Edge/Electron 完全支持，用 `<img>` 标签播放）。

## 备注

素材缺失时对应元素静默隐藏，过渡段缺失时播放层走 crossfade 兜底，不影响功能。
