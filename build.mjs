import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', minify: true, write: false, target: 'es2020' });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const bgm = fs.existsSync('music/score.mp3') ? fs.readFileSync('music/score.mp3').toString('base64') : '';
const html = fs.readFileSync('src/template.html', 'utf8').replace('/*__AUDIO__*/', () => bgm).replace('/*__BUNDLE__*/', () => js);
fs.writeFileSync('index.html', html);
fs.mkdirSync('public', { recursive: true }); fs.writeFileSync('public/index.html', html);   // what Vercel serves
console.log('ok', (html.length/1024).toFixed(0)+'KB');
