import { onMount } from "solid-js"

/**
 * 姜晓启动画面：冷启动时展示（黑金唐风 + 姜晓主题字）
 * - 仅姜晓主题下生效，1.8s 后淡出
 * - 纯视觉组件，不影响任何功能
 */
export function JiangxiaoSplash() {
  onMount(() => {
    const el = document.getElementById("jiangxiao-splash")
    if (!el) return
    setTimeout(() => {
      el.classList.add("jiangxiao-splash-hidden")
      setTimeout(() => el.remove(), 600)
    }, 1800)
  })

  return (
    <div
      id="jiangxiao-splash"
      style={{
        position: "fixed",
        inset: 0,
        "z-index": 9999,
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
        gap: "18px",
        background:
          "radial-gradient(ellipse at 50% 40%, #1f1a12 0%, #121008 60%, #0d0b08 100%)",
        transition: "opacity 0.6s ease",
      }}
    >
      {/* 宝相花纹 */}
      <div
        style={{
          width: "88px",
          height: "88px",
          opacity: 0.9,
          background: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='88' height='88' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='%23d6b34a' stroke-opacity='0.85'%3E%3Cpath d='M60 14c7 9 22 10 28 0 4-7-2-15-11-15-7 0-15 7-17 15z'/%3E%3Ccircle cx='60' cy='52' r='16'/%3E%3Ccircle cx='60' cy='52' r='8'/%3E%3Ccircle cx='60' cy='52' r='3' fill='%23d6b34a' fill-opacity='0.2'/%3E%3Cpath d='M60 74c-5 7-5 16 0 23 5-7 5-16 0-23z'/%3E%3Cpath d='M36 50c-9-2-16 3-18 9-2 7 3 13 10 15 7 2 11-3 9-9-2-7-11-12-11-12z'/%3E%3Cpath d='M84 50c9-2 16 3 18 9 2 7-3 13-10 15-7 2-11-3-9-9 2-7 11-12 11-12z'/%3E%3C/g%3E%3C/svg%3E") center / contain no-repeat`,
          animation: "jiangxiao-splash-spin 3.2s linear infinite",
        }}
      />
      <style>{`
        @keyframes jiangxiao-splash-spin {
          0% { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(180deg) scale(1.05); }
          100% { transform: rotate(360deg) scale(1); }
        }
        #jiangxiao-splash.jiangxiao-splash-hidden {
          opacity: 0;
        }
      `}</style>
      <div style={{ color: "#d6b34a", "font-size": "26px", "font-weight": 600, "letter-spacing": "0.35em", "text-shadow": "0 0 18px rgba(214,179,74,0.45)" }}>
        姜晓
      </div>
      <div style={{ color: "#8d8474", "font-size": "12px", "letter-spacing": "0.25em" }}>
        唐 风 开 发 助 手
      </div>
    </div>
  )
}
