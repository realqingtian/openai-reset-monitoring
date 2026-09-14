import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 开发期前后端各自独立起进程：/api、/healthz 代理到本机后端，避免跨域；
// 生产构建产物 dist/ 由 FastAPI 同源托管（见 app/main.py）。
//
// 后端端口固定 8730（与代码内置默认 MONITOR_PORT 保持一致，.env 未显式配置时即此值）；
// 若修改后端端口，需同步修改这里和启动脚本里的说明。
const BACKEND_ORIGIN = 'http://127.0.0.1:8730'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': BACKEND_ORIGIN,
      '/healthz': BACKEND_ORIGIN,
    },
  },
})
