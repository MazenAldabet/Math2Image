import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

let puppeteer;
let chromium;

if (isLambda) {
    chromium = (await import('@sparticuz/chromium')).default;
    puppeteer = (await import('puppeteer-core')).default;
} else {
    puppeteer = (await import('puppeteer')).default;
}

const s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
});

function parseEvent(event) {
    if (!event) return {};
    if (typeof event === 'string') return JSON.parse(event);
    if (typeof event.body === 'string') return JSON.parse(event.body);
    return event;
}

function response(statusCode, body) {
    return {
        statusCode,
        body: typeof body === 'string' ? body : JSON.stringify(body),
    };
}

function getFontDataUrl(fileName) {
    const basePath = isLambda ? '/var/task/fonts' : path.join(process.cwd(), 'fonts');
    const fontPath = path.join(basePath, fileName);
    const fontBuffer = fs.readFileSync(fontPath);
    return `data:font/ttf;base64,${fontBuffer.toString('base64')}`;
}

function escapeHtmlForAttribute(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function setPageContentWithRetry(browser, page, html, options, retries = 5) {
    let activePage = page;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            await activePage.setContent(html, options);
            return activePage;
        } catch (error) {
            const isEarlyMainFrame = error?.message?.includes('Requesting main frame too early!');
            const isDetachedFrame = error?.message?.includes('detached Frame');

            if ((!isEarlyMainFrame && !isDetachedFrame) || attempt === retries) {
                throw error;
            }

            await new Promise((resolve) => setTimeout(resolve, 200 * attempt));

            const openPages = await browser.pages();
            activePage = openPages.find((candidate) => !candidate.isClosed()) || (await browser.newPage());
        }
    }
}

function decodeNumericEntities(value) {
    return value.replace(/&#(x?[0-9a-f]+);/gi, (_, rawCode) => {
        const isHex = rawCode[0].toLowerCase() === 'x';
        const codePoint = Number.parseInt(isHex ? rawCode.slice(1) : rawCode, isHex ? 16 : 10);
        if (!Number.isFinite(codePoint)) {
            return _;
        }
        try {
            return String.fromCodePoint(codePoint);
        } catch {
            return _;
        }
    });
}

function escapeMathText(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function isArabicText(value) {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(value);
}

function normalizeArabicMathMi(content) {
    const decoded = decodeNumericEntities(content).replace(/\s+/g, ' ').trim();
    if (!decoded || !isArabicText(decoded)) {
        return null;
    }

    const breakableText = escapeMathText(decoded).replace(/ /g, '&#8203; ');
    return `<mtext>${breakableText}</mtext>`;
}

function stripMathTags(mathContent) {
    return mathContent
        .replace(/<\/?(math|mrow|mstyle|mtext|mi|mo|mn|ms|mspace)[^>]*>/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isSimpleArabicMathBlock(mathBlock) {
    const disallowedTags = /<(mfrac|msup|msub|msqrt|mroot|munder|mover|munderover|mtable|mtr|mtd|mfenced|semantics|annotation|annotation-xml)\b/i;
    return !disallowedTags.test(mathBlock) && containsArabicMathContent(mathBlock);
}

function convertMultilineMathBlock(mathBlock) {
    const match = mathBlock.match(/^<math([^>]*)>([\s\S]*)<\/math>$/i);
    if (!match) {
        return mathBlock;
    }

    const [, mathAttrs = '', innerContent] = match;
    const normalizedBreaks = innerContent.replace(
        /<mspace\b[^>]*linebreak=(?:"newline"|'newline')[^>]*\/>(?:\s*<mo>(?:&#160;|&nbsp;)<\/mo>)*/gi,
        '[[MATH_NL]]'
    );

    const segments = normalizedBreaks
        .split('[[MATH_NL]]')
        .map((segment) => segment.trim())
        .filter(Boolean);

    if (segments.length <= 1) {
        return mathBlock;
    }

    return `<div class="math-multiline">${segments
        .map((segment) => `<div class="math-line"><math${mathAttrs}>${segment}</math></div>`)
        .join('')}</div>`;
}

function convertSimpleArabicMathBlock(mathBlock) {
    const text = decodeNumericEntities(stripMathTags(mathBlock));
    if (!text || !isArabicText(text)) {
        return mathBlock;
    }

    return `<span class="math-text-run" dir="rtl">${escapeMathText(text)}</span>`;
}

function wrapInlineRtlMath(html) {
    return html.replace(
        /(<(?:p|div|span|strong|em|li)\b[^>]*\bdir=(?:"rtl"|'rtl')[^>]*>[\s\S]*?)(<math[\s\S]*?<\/math>)([\s\S]*?<\/(?:p|div|span|strong|em|li)>)/gi,
        (fullMatch, before, mathBlock, after) => `${before}<span class="inline-math-rtl" dir="rtl">${mathBlock}</span>${after}`
    );
}

function reorderAdjacentArabicAndInlineMath(html) {
    return html.replace(
        /<span class="inline-math-rtl" dir="rtl">([\s\S]*?<\/math>)<\/span>([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s&nbsp;]+)/gu,
        (fullMatch, mathBlock, arabicText) => `<span class="rtl-inline-run" dir="rtl">${arabicText}<span class="inline-math-rtl" dir="rtl">${mathBlock}</span></span>`
    );
}

function containsArabicMathContent(html) {
    const mathBlocks = html.match(/<math[\s\S]*?<\/math>/gi) || [];
    return mathBlocks.some((block) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(decodeNumericEntities(block)));
}
export function preprocessHtmlForRender(html) {
    const withInlineRtlMath = wrapInlineRtlMath(html);
    const withAdjacentInlineOrderFixed = reorderAdjacentArabicAndInlineMath(withInlineRtlMath);

    const withMultilineMathBlocks = withAdjacentInlineOrderFixed.replace(/<math[\s\S]*?<\/math>/gi, (mathBlock) => {
        return convertMultilineMathBlock(mathBlock);
    });

    const withSimpleArabicMathAsHtml = withMultilineMathBlocks.replace(/<math[\s\S]*?<\/math>/gi, (mathBlock) => {
        return isSimpleArabicMathBlock(mathBlock)
            ? convertSimpleArabicMathBlock(mathBlock)
            : mathBlock;
    });

    const withNormalizedMi = withSimpleArabicMathAsHtml.replace(/<mi>([\s\S]*?)<\/mi>/gi, (fullMatch, content) => {
        if (/<[^>]+>/.test(content)) {
            return fullMatch;
        }

        const normalized = normalizeArabicMathMi(content);
        return normalized ? normalized : fullMatch;
    });

    // Wrap math blocks with <p> if not already wrapped
    const wrappedMath = withNormalizedMi.replace(
        /(<math[\s\S]*?<\/math>)/gi,
        (mathBlock) => `<span>${mathBlock}</span>`
    );

    return wrappedMath;
}

export const handler = async (event) => {
    let browser;

    try {
        const {
            html,
            bucket,
            key,
            storage = 'local',
            maxWidth = 300,
            padding = 0,
            useWiris = false,
            direction = 'rtl',
        } = parseEvent(event);

        if (!html) {
            return response(400, { error: 'html is required' });
        }

        if (storage === 's3' && (!bucket || !key)) {
            return response(400, { error: 'bucket and key required for s3' });
        }

        const processedHtml = preprocessHtmlForRender(html);
        const effectiveUseWiris = useWiris && !containsArabicMathContent(html);

        const initialViewport = {
            width: Math.max(1, Number(maxWidth) || 300),
            height: 800,
            deviceScaleFactor: 2,
        };

        browser = await puppeteer.launch(
            isLambda
                ? {
                      args: [...chromium.args, '--font-render-hinting=none'],
                      executablePath: await chromium.executablePath(),
                      headless: chromium.headless,
                      defaultViewport: initialViewport,
                  }
                : {
                      executablePath:
                          process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
                      headless: 'new',
                      defaultViewport: initialViewport,
                      args: [
                          '--no-sandbox',
                          '--disable-setuid-sandbox',
                          '--disable-dev-shm-usage',
                      ],
                  }
        );

        const existingPages = await browser.pages();
        let page = existingPages[0] || (await browser.newPage());

        page.on('console', (msg) => {
            console.log('[PAGE LOG]', msg.text());
        });

        page.on('pageerror', (err) => {
            console.error('[PAGE ERROR]', err);
        });

        const safeDirection = direction === 'ltr' ? 'ltr' : 'rtl';
        const escapedWirisFlag = escapeHtmlForAttribute(effectiveUseWiris ? '1' : '0');
        const tajawalFont = getFontDataUrl('Tajawal-Regular.ttf');

        const wrappedHtml = `<!doctype html>
<html dir="${safeDirection}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
@font-face {
  font-family: 'Tajawal';
  src: url('${tajawalFont}') format('truetype');
  font-weight: normal;
  font-style: normal;
}

html, body {
  background: transparent !important;
  margin: 0;
  padding: 0;
}

body {
  display: inline-block;
}

#capture {
  direction: ${safeDirection};
  unicode-bidi: isolate;
  display: inline-block;
  max-width: ${Number(maxWidth) || 300}px;
  padding: ${Number(padding) || 0}px;
  box-sizing: border-box;
  margin: 0;

  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
}

#capture {
  font-family: 'Noto Naskh Arabic', 'Noto Sans Arabic', 'Tajawal', sans-serif !important;
}

#capture p,
#capture div,
#capture li {
  display: block;
  margin: 0 0 0.6em;
}

#capture p:last-child,
#capture div:last-child,
#capture li:last-child {
  margin-bottom: 0;
}

#capture .math-text-run {
  display: inline;
  white-space: normal;
  overflow-wrap: break-word;
  word-break: normal;
  line-height: 1.5;
  font-family: 'Noto Naskh Arabic', 'Noto Sans Arabic', 'Tajawal', sans-serif !important;
}

#capture .math-multiline {
  display: block;
  max-width: 100%;
}

#capture .math-line {
  display: block;
}

#capture .inline-math-rtl {
  display: inline-flex;
  direction: rtl;
  unicode-bidi: isolate;
  vertical-align: middle;
}

#capture .inline-math-rtl math {
  display: inline-block;
}

#capture .rtl-inline-run {
  display: inline;
  direction: rtl;
  unicode-bidi: isolate;
}

#capture math,
#capture math * {
  font-family: 'Noto Math', math, 'Cambria Math', 'STIX Two Math', serif !important;
}

#capture math[dir="rtl"] {
  display: block;
  max-width: 100%;
  direction: rtl;
  unicode-bidi: isolate;
  white-space: normal;
}

#capture math[dir="rtl"] mi,
#capture math[dir="rtl"] mtext,
#capture math[dir="rtl"] ms {
  font-family: 'Noto Naskh Arabic', 'Noto Sans Arabic', 'Tajawal', sans-serif !important;
  font-size: 1.14em;
  font-weight: 500;
  line-height: 1.5;
  letter-spacing: 0;
  direction: rtl;
  unicode-bidi: plaintext;
}

#capture math[dir="rtl"] mtext {
  white-space: normal;
}

#capture img {
  vertical-align: middle;
  max-width: 100%;
  height: auto;
}
</style>

<script>
(function () {
  window.__wirisDone = ${effectiveUseWiris ? 'false' : 'true'};
  window.__wirisEnabled = ${effectiveUseWiris ? 'true' : 'false'};

  function markWirisDone() {
    window.__wirisDone = true;
  }

  async function waitForImages() {
    const images = Array.from(document.images || []);
    await Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      })
    );
  }

  function loadWirisScript() {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-wiris="true"]');

      if (existing) {
        if (window.WirisPlugin) {
          resolve();
          return;
        }

        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', (e) => reject(e), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://www.wiris.net/demo/plugins/app/WIRISplugins.js?viewer=image';
      script.async = true;
      script.dataset.wiris = 'true';

      script.onload = () => resolve();
      script.onerror = (e) => reject(e);

      document.head.appendChild(script);
    });
  }

  async function processWiris() {
    if (!window.__wirisEnabled) {
      markWirisDone();
      return;
    }

    try {
      await loadWirisScript();

      if (window.WirisPlugin && typeof window.WirisPlugin.parseElements === 'function') {
        window.WirisPlugin.parseElements();
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
      await waitForImages();
    } catch (error) {
      console.error('WIRIS load/process failed:', error);
    } finally {
      markWirisDone();
    }
  }

  window.addEventListener('load', () => {
    processWiris();
  });
})();
</script>
</head>
<body data-use-wiris="${escapedWirisFlag}">
  <div id="capture">${processedHtml}</div>
</body>
</html>`;

        page = await setPageContentWithRetry(browser, page, wrappedHtml, { waitUntil: 'domcontentloaded' });

        await page.evaluate(async () => {
            if (document.fonts && document.fonts.ready) {
                await document.fonts.ready;
            }
        });

        if (effectiveUseWiris) {
            await page.waitForFunction(() => window.__wirisDone === true, {
                timeout: 15000,
            });
        }

        await page.evaluate(() => {
            return new Promise((resolve) => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(resolve);
                });
            });
        });

        const final = await page.evaluate(() => {
            const el = document.getElementById('capture');
            if (!el) {
                throw new Error('#capture element not found');
            }

            const rect = el.getBoundingClientRect();

            return {
                width: Math.ceil(rect.width),
                height: Math.ceil(rect.height),
            };
        });

        await page.evaluate(() => {
            return new Promise((resolve) => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(resolve);
                });
            });
        });

        const el = await page.$('#capture');
        if (!el) {
            throw new Error('Could not find #capture for screenshot');
        }

        const imageBuffer = await el.screenshot({
            type: 'png',
            omitBackground: true,
            captureBeyondViewport: true,
        });

        await browser.close();
        browser = null;

        if (storage === 'local') {
            const fileName = key || `test-image-${Date.now()}.png`;
            const baseDir = isLambda ? '/output' : path.join(process.cwd(), 'output');
            const localPath = path.join(baseDir, fileName);

            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            fs.writeFileSync(localPath, imageBuffer);

            return response(200, {
                message: 'Stored locally for testing',
                path: localPath,
                width: final.width,
                height: final.height,
                size: imageBuffer.length,
                useWiris: effectiveUseWiris,
            });
        }

        await s3.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: imageBuffer,
                ContentType: 'image/png',
            })
        );

        return response(200, {
            message: 'Uploaded to S3',
            bucket,
            key,
            width: final.width,
            height: final.height,
            size: imageBuffer.length,
            useWiris: effectiveUseWiris,
        });
    } catch (error) {
        console.error('Lambda Error:', error);

        if (browser) {
            try {
                await browser.close();
            } catch {}
        }

        return response(500, {
            error: error.message || 'Unknown error',
        });
    }
};
