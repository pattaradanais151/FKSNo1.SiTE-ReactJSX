import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// jsxImportSource ทำให้ใช้ css prop ของ Emotion ได้ใน .jsx โดยไม่ต้องใส่ pragma
export default defineConfig({
  plugins: [react({ jsxImportSource: '@emotion/react' }), tailwindcss()],
  css: {
    preprocessorOptions: {
      scss: {
        // Bootstrap 5.3 ยังใช้ @import ของ Sass จึงปิดคำเตือน Deprecation ที่มาจาก node_modules
        quietDeps: true,
        silenceDeprecations: ['import', 'global-builtin', 'color-functions'],
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})