/* Renders the PNG icons and the .ico from public/icon.svg, so every size comes
   from one drawing. Run again if the mark changes. */
import { chromium } from 'playwright';
import fs from 'fs';

const svg = fs.readFileSync('public/icon.svg', 'utf8');
const square = svg.replace('rx="14"', 'rx="0"'); // iOS applies its own mask
const uri = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await b.newContext({ deviceScaleFactor: 1 })).newPage();

async function png(source, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0"><img src="${uri(source)}" width="${size}" height="${size}" style="display:block"></body>`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(out, size + 'px', fs.statSync(out).size + ' bytes');
}

await png(square, 180, 'public/apple-touch-icon.png');
await png(svg, 512, 'public/icon-512.png');
await png(svg, 32, '/tmp/icon-32.png');
await b.close();

// An .ico may simply wrap a PNG: 6-byte header, one 16-byte directory entry.
const body = fs.readFileSync('/tmp/icon-32.png');
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = 32; head[7] = 32; head[8] = 0; head[9] = 0;
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(body.length, 14); head.writeUInt32LE(22, 18);
fs.writeFileSync('public/favicon.ico', Buffer.concat([head, body]));
console.log('public/favicon.ico', fs.statSync('public/favicon.ico').size + ' bytes');
