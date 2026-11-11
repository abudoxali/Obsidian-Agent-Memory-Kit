// Renders a plain-text demo transcript as an SVG "terminal" image (for docs/showcase).
// Usage: node scripts/render-transcript.mjs <transcript.txt> <out.svg>
import fs from 'node:fs';
const [, , inFile, outFile] = process.argv;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = fs.readFileSync(inFile, 'utf8').split('\n');
while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
const lh = 20, pad = 28, top = 92, W = 1240;
const H = top + lines.length * lh + 56;
const body = lines.map((l, i) => {
  const y = top + i * lh;
  let fill = '#C8D2E8', weight = 400, text = esc(l);
  if (l.startsWith('==')) { fill = '#A78BFA'; weight = 700; }
  else if (/^\s+PASS/.test(l)) text = `<tspan fill="#2DD4BF" font-weight="700">PASS</tspan>${esc(l.replace(/^\s+PASS/, ''))}`.replace(/^/, '  ');
  else if (/^\s+FAIL/.test(l)) text = `<tspan fill="#F87171" font-weight="700">FAIL</tspan>${esc(l.replace(/^\s+FAIL/, ''))}`.replace(/^/, '  ');
  else if (l.startsWith('DEMO RESULT')) { fill = '#2DD4BF'; weight = 700; }
  else if (l.startsWith('VYMEM demo')) fill = '#F8FAFC';
  return `<text x="${pad}" y="${y}" fill="${fill}" font-weight="${weight}" xml:space="preserve">${text}</text>`;
}).join('\n');
fs.writeFileSync(outFile, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Output of the VYMEM synthetic demo">
<rect width="${W}" height="${H}" rx="18" fill="#090D19"/><rect x="0" y="0" width="${W}" height="52" rx="18" fill="#111831"/><rect x="0" y="34" width="${W}" height="18" fill="#111831"/>
<circle cx="30" cy="26" r="6" fill="#3A456C"/><circle cx="52" cy="26" r="6" fill="#3A456C"/><circle cx="74" cy="26" r="6" fill="#3A456C"/>
<text x="102" y="31" font-family="Inter, 'Segoe UI', sans-serif" font-size="14" fill="#98A6C2">$ npm run demo   -  Illustrative demo: real execution on a synthetic vault, not a production capture</text>
<g font-family="Consolas, 'Courier New', monospace" font-size="13">
${body}
</g></svg>
`);
