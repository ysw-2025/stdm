const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = __dirname;
const HTML = path.join(ROOT, 'xhs_preview.html');
const OUT = path.join(ROOT, 'xhs_export');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

let payload = null;
const jsonPath = path.join(ROOT, 'xhs_stdm_data.json');
if (fs.existsSync(jsonPath)) {
  try { payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); console.log('已读取 xhs_stdm_data.json'); }
  catch (e) { console.error('JSON 解析失败', e); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/dell/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  const fileUrl = 'file://' + HTML.replace(/\\/g, '/');

  // 在页面脚本执行前注入数据，确保 loadXHSData 能读到
  if (payload) {
    await page.addInitScript(p => { window.__XHS_DATA__ = p; }, payload);
  }
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: '.stage{zoom:1 !important; display:block !important; align-items:stretch !important; padding:0 !important; gap:0 !important;} .page{box-shadow:none !important; margin:0 !important; width:1080px !important; height:1440px !important; min-height:1440px !important; overflow:hidden !important;} .toolbar{display:none !important;}' });
  await page.waitForFunction(() => document.fonts.ready && document.fonts.status === 'loaded', null, { timeout: 10000 });
  await page.waitForTimeout(400);

  // 强制移除预览缩放，确保每张 .page 都是 1080×1440
  await page.evaluate(() => new Promise((res) => {
    const s = document.querySelector('.stage');
    if(s){ s.style.zoom = '1'; s.style.display = 'block'; s.style.alignItems = 'stretch'; s.style.padding = '0'; s.style.gap = '0'; }
    document.querySelectorAll('.page').forEach((p) => {
      p.style.width = '1080px';
      p.style.height = '1440px';
      p.style.minHeight = '1440px';
      p.style.overflow = 'hidden';
      p.style.marginBottom = '0';
      p.style.transform = 'none';
    });
    requestAnimationFrame(() => res());
  }));
  await page.waitForTimeout(300);

  const pages = await page.locator('.page').count();
  for (let i = 1; i <= pages; i++) {
    const el = page.locator('.page').nth(i - 1);
    await el.screenshot({ path: path.join(OUT, String(i).padStart(2, '0') + '.png'), type: 'png' });
  }

  // 额外生成「诊断报告长图 PDF」
  try {
    await page.waitForFunction(() => typeof window.jspdf !== 'undefined', null, { timeout: 8000 });
    const pdfPath = path.join(OUT, 'stdm_report.pdf');
    const [ download ] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.evaluate(() => generateReportPDF())
    ]);
    await download.saveAs(pdfPath);
    console.log('报告 PDF 已导出：', pdfPath);
  } catch (e) {
    console.warn('报告 PDF 生成跳过（jsPDF 未加载或超时）：', e.message);
    // 兜底：把报告长图截成 PNG
    try {
      const ph = await page.evaluate(async () => {
        const wrap = document.createElement('div');
        wrap.innerHTML = buildReportLongHTML();
        const el = wrap.firstElementChild;
        document.body.appendChild(el);
        await document.fonts.ready;
        await new Promise(r => setTimeout(r, 300));
        return null;
      });
      const rl = page.locator('#reportLongEl');
      if (await rl.count()) {
        await rl.screenshot({ path: path.join(OUT, 'stdm_report.png'), type: 'png' });
        console.log('报告长图已兜底导出为 PNG：', path.join(OUT, 'stdm_report.png'));
      }
    } catch (_) {}
  }

  await browser.close();
  console.log('导出完成：', OUT);
})();
