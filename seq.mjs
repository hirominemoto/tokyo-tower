// node seq.mjs '[[t0,t1,name],...]' [ss] [html]  -> frames/name/%05d.jpg at 30fps (frame number = absolute)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const segs = JSON.parse(process.argv[2]); const ss = +(process.argv[3]||1); const html = process.argv[4] || 'index.html';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: ss });
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto('file://' + process.cwd() + '/' + html + '?render&ss=' + ss, { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready === true, null, {timeout: 120000});
for (const [t0, t1, name] of segs) {
  fs.mkdirSync('frames/' + name, { recursive: true }); const s = Date.now(); let n = 0;
  for (let f = Math.round(t0 * 30); f < Math.round(t1 * 30); f++, n++) { const out = `frames/${name}/${String(f).padStart(5, '0')}.jpg`; if (fs.existsSync(out)) continue; await p.evaluate((t) => window.__renderAt(t), f / 30); await p.screenshot({ path: out + '.tmp.jpg', type: 'jpeg', quality: 95 }); fs.renameSync(out + '.tmp.jpg', out); }
  console.log(name, n, ((Date.now() - s) / 1000).toFixed(0) + 's');
}
await b.close();
