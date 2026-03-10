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

export const handler = async (event) => {
    try {
        const { html, bucket, key, storage = 's3', maxWidth = 500, padding = 0 } = parseEvent(event);

        if (!html) return response(400, { error: 'html is required' });

        if (storage === 's3' && (!bucket || !key)) {
            return response(400, { error: 'bucket and key required for s3' });
        }

        const browser = await puppeteer.launch(
            isLambda
                ? {
                      args: [...chromium.args, '--font-render-hinting=none'],
                      executablePath: await chromium.executablePath(),
                      headless: chromium.headless,
                  }
                : { headless: true }
        );

        const page = await browser.newPage();

        // Start with a safe viewport
        await page.setViewport({ width: maxWidth, height: 800, deviceScaleFactor: 2 });

        // Wrap in a capture container (this is what we measure & screenshot)
        const wrappedHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
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
    }
    html, body { margin: 0; padding: 0; }
    #capture {
      display: inline-block;
      padding: ${padding}px;
      box-sizing: border-box;
      margin: 0;
    }
    #capture * {
      font-family: 'Tajawal', 'Noto Sans Arabic', sans-serif !important;
    }
  </style>
</head>
<body>
  <div id="capture">${html}</div>
</body>
</html>`;

        await page.setContent(wrappedHtml, { waitUntil: 'networkidle0' });

        // Make sure layout is stable
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

        // Measure capture box and compute downscale if needed
        const { width, height, scale } = await page.evaluate((mw) => {
            const el = document.getElementById('capture');
            const rect = el.getBoundingClientRect();
            const w = Math.ceil(rect.width);
            const h = Math.ceil(rect.height);
            const s = w > mw ? mw / w : 1;
            return { width: w, height: h, scale: s };
        }, maxWidth);

        // Apply scale if content is wider than maxWidth
        if (scale < 1) {
            await page.evaluate((s) => {
                const el = document.getElementById('capture');
                el.style.transformOrigin = 'top left';
                el.style.transform = `scale(${s})`;
            }, scale);

            // wait for reflow
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        }

        // Re-measure after scaling to get final size
        const final = await page.evaluate(() => {
            const el = document.getElementById('capture');
            const rect = el.getBoundingClientRect();
            return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
        });

        // Set viewport to final dimensions to avoid any clipping issues
        await page.setViewport({
            width: Math.max(1, Math.min(final.width, maxWidth)),
            height: Math.max(1, final.height),
            deviceScaleFactor: 2,
        });

        const el = await page.$('#capture');
        const imageBuffer = await el.screenshot({ type: 'png' });

        await browser.close();

        // LOCAL STORAGE
        if (storage === 'local') {
            const fileName = key || `image-${Date.now()}.png`;
            const localPath = isLambda ? path.join('/tmp', fileName) : path.join(process.cwd(), fileName);

            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            fs.writeFileSync(localPath, imageBuffer);

            return response(200, {
                message: 'Stored locally',
                path: localPath,
                size: imageBuffer.length,
                width: Math.min(final.width, maxWidth),
                height: final.height,
            });
        }

        // S3 STORAGE
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
            size: imageBuffer.length,
            width: Math.min(final.width, maxWidth),
            height: final.height,
        });
    } catch (error) {
        console.error('Lambda Error:', error);
        return response(500, { error: error.message });
    }
};