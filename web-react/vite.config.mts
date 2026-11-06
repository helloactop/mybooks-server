import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/mybooks/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // 新前端资源均在 /mybooks/ 下；其余请求交给旧服务，复用登录与 Cookie。
      // 保留浏览器 Host，使后端 Origin 校验也能保护开发环境的写请求。
      '^/(?!mybooks(?:/|$))': {
        target: process.env.MYBOOKS_DEV_BACKEND || 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
});
