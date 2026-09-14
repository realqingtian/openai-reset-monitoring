import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 开发期前后端各自独立起进程：/api、/healthz 代理到本机后端，避免跨域；
// 生产构建产物 dist/ 由 FastAPI 同源托管（见 app/main.py）。
//
// 后端端口固定 8080（与 .env 的 MONITOR_PORT 保持一致）；
// 若修改后端端口，需同步修改这里和根目录 dev.sh。
const BACKEND_ORIGIN = 'http://127.0.0.1:8080'

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
