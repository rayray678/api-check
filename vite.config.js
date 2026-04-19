import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * @description Vite 配置文件。
 * @see https://vitejs.dev/config/
 */
export default defineConfig({
    // 指定前端项目的根目录为 'frontend'
    root: 'frontend',
    // 配置 Vite 插件
    plugins: [
        vue(), // 启用 Vue 3 单文件组件支持
    ],
    // 配置模块解析别名
    resolve: {
        alias: {
            // 设置 '@' 别名，指向 './frontend/src' 目录，方便导入模块
            '@': fileURLToPath(new URL('./frontend/src', import.meta.url))
        }
    },
    // 开发服务器配置
    server: {
        // 配置代理，将 ' /proxy' 请求转发到本地运行的 Cloudflare Worker
        proxy: {
            '/proxy': {
                target: 'http://127.0.0.1:8787', // 默认的 wrangler dev 端口
                changeOrigin: true, // 改变源，以匹配目标 URL
            }
        }
    }
});
