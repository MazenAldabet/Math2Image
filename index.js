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

function escapeHtmlForAttribute(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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

        browser = await puppeteer.launch(
            isLambda
                ? {
                      args: [...chromium.args, '--font-render-hinting=none'],
                      executablePath: await chromium.executablePath(),
                      headless: chromium.headless,
                  }
                : {
                      executablePath:
                          process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
                      headless: 'new',
                      args: [
                          '--no-sandbox',
                          '--disable-setuid-sandbox',
                      ],
                  }
        );

        const page = await browser.newPage();

        page.on('console', (msg) => {
            console.log('[PAGE LOG]', msg.text());
        });

        page.on('pageerror', (err) => {
            console.error('[PAGE ERROR]', err);
        });

        await page.setViewport({
            width: Math.max(1, Number(maxWidth) || 300),
            height: 800,
            deviceScaleFactor: 2,
        });

        const safeDirection = direction === 'ltr' ? 'ltr' : 'rtl';
        const escapedWirisFlag = escapeHtmlForAttribute(useWiris ? '1' : '0');

        const wrappedHtml = `<!doctype html>
<html dir="${safeDirection}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
@font-face {
  font-family: 'Tajawal';
  src: url('file:///var/task/fonts/Tajawal-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

@font-face {
  font-family: 'Noto Sans Arabic';
  src: url('file:///var/task/fonts/NotoSansArabic-Regular.ttf') format('truetype');
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
  unicode-bidi: embed;
  display: inline-block;
  max-width: ${Number(maxWidth) || 300}px;
  padding: ${Number(padding) || 0}px;
  box-sizing: border-box;
  margin: 0;

  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
}

#capture,
#capture * {
  font-family: 'Tajawal', 'Noto Sans Arabic', sans-serif !important;
}

#capture img {
  vertical-align: middle;
  max-width: 100%;
  height: auto;
}
</style>

<script>
(function () {
  window.__wirisDone = ${useWiris ? 'false' : 'true'};
  window.__wirisEnabled = ${useWiris ? 'true' : 'false'};

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
  <div id="capture">${html}</div>
</body>
</html>`;

        await page.setContent(wrappedHtml, { waitUntil: 'domcontentloaded' });

        await page.evaluate(async () => {
            if (document.fonts && document.fonts.ready) {
                await document.fonts.ready;
            }
        });

        if (useWiris) {
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

        await page.setViewport({
            width: Math.max(1, final.width),
            height: Math.max(1, final.height),
            deviceScaleFactor: 2,
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
                useWiris,
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
            useWiris,
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