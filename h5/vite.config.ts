import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        ...(env.VITE_COS_PROXY_TARGET
          ? {
              '/cos-upload': {
                target: env.VITE_COS_PROXY_TARGET,
                changeOrigin: true,
                rewrite: (path: string) => path.replace(/^\/cos-upload/, ''),
              },
            }
          : {}),
      },
    },
  }
})
