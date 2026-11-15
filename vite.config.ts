import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' 讓 GitHub Pages 子路徑（/repo-name/）也能正確載入資源
export default defineConfig({
  plugins: [react()],
  base: './',
});
