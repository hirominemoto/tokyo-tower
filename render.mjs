import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import fs from 'fs';
const segs = JSON.parse(process.argv[2]); // [[f0,f1,name],...]
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto('file:///home/claude/tower/index.html?render', { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready === true);
for (const [f0, f1, name] of segs) {
  const tmp = `out/${name}.tmp.mp4`;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', tmp]);
  const done = new Promise(r => ff.on('close', r));
  const s = Date.now();
  for (let f = f0; f < f1; f++) {
    await p.evaluate((t) => window.__renderAt(t), f / 30);
    const buf = await p.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - f0) % 30 === 0) fs.writeFileSync(`out/${name}.progress`, `${f - f0}/${f1 - f0} ${((Date.now() - s) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); const code = await done;
  if (code === 0) fs.renameSync(tmp, `out/${name}.mp4`);
  console.log(name, 'done', code, ((Date.now() - s) / 1000).toFixed(0) + 's');
}
await b.close();
