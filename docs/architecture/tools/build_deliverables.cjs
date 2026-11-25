// Build docs/deliverables/*.md into styled PDF (headless Chromium) and DOCX (pandoc).
//   node docs/architecture/tools/build_deliverables.cjs
// Outputs land in docs/deliverables/dist/. Prints page counts and dossier word count (body, excl. appendices).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = path.resolve(__dirname, '../../deliverables');
const DIST = path.join(DIR, 'dist');
fs.mkdirSync(DIST, { recursive: true });
const docs = [
  { src: 'architecture-brief.md', cls: 'brief', toc: false },
  { src: 'design-dossier.md', cls: 'dossier', toc: true },
].filter(d => fs.existsSync(path.join(DIR, d.src)));

(async () => {
  const browser = await chromium.launch();
  for (const d of docs) {
    const base = d.src.replace(/\.md$/, '');
    const html = path.join(DIST, `${base}.html`);
    const args = [d.src, '--standalone', '--embed-resources', '--resource-path', DIR, '--css', 'style.css',
      '--metadata', `pagetitle=${base}`, '-V', `classoption=${d.cls}`, '-o', html];
    if (d.toc) args.push('--toc', '--toc-depth=2');
    execFileSync('pandoc', args, { cwd: DIR });
    let h = fs.readFileSync(html, 'utf8').replace('<body>', `<body class="${d.cls}">`);
    fs.writeFileSync(html, h);
    execFileSync('pandoc', [d.src, '--resource-path', DIR, ...(d.toc ? ['--toc'] : []), '-o', path.join(DIST, `${base}.docx`)], { cwd: DIR });
    const page = await browser.newPage();
    await page.goto('file://' + html);
    const pdf = path.join(DIST, `${base}.pdf`);
    await page.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:7pt;color:#6b7280;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>Rupay - ${base.replace(/-/g, ' ')}</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>` });
    const pages = (fs.readFileSync(pdf, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    let words = '';
    if (d.cls === 'dossier') {
      const md = fs.readFileSync(path.join(DIR, d.src), 'utf8').replace(/^---[\s\S]*?---/, '');
      const body = md.split(/^# Appendices/m)[0].replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/[|#*`>_-]/g, ' ');
      words = `, body words (excl. appendices): ${body.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length}`;
    }
    console.log(`${base}: ${pages} pages${words}`);
  }
  await browser.close();
})();
