import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),build:{outDir:'dist',emptyOutDir:true,sourcemap:'hidden'},server:{host:'0.0.0.0',port:5173,proxy:{'/api':'http://localhost:3000','/health':'http://localhost:3000'}}});
