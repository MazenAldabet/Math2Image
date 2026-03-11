import assert from 'node:assert/strict';
import { preprocessHtmlForRender, shouldUseWirisForHtml } from '../index.js';

const input = `<p><math dir="rtl" xmlns="http://www.w3.org/1998/Math/MathML"><mi>&#1575;&#1604;&#1605;&#1578;&#1608;&#1587;&#1617;&#1616;&#1591;&#1615; &#1578;&#1602;&#1585;&#1610;&#1576;&#1611;&#1575;</mi><mo>=</mo><mn>5</mn></math></p><p>فقرة خارج المعادلة</p>`;
const multilineMathInput = `<p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>a</mi><mo>=</mo><mi>b</mi><mspace linebreak="newline"/><mo>&#160;</mo><mo>&#160;</mo><mo>=</mo><mi>c</mi></math></p>`;
const inlineRtlMathInput = `<p dir="rtl">الناتج <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>+</mo><mn>1</mn></math> صحيح</p>`;
const adjacentMathArabicInput = `<p dir="rtl"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>s</mi><mi>e</mi><mi>c</mi><mo>&#160;</mo><mi>&#952;</mi></math>المطلوب هو&nbsp;</p>`;
const lambdaInlineRtlInput = `<p dir="rtl">إذا كانت الدالة&nbsp;<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>s</mi><mo>(</mo><mi>t</mi><mo>)</mo><mo>=</mo><mn>2</mn><msup><mi>t</mi><mn>2</mn></msup><mo>+</mo><mn>3</mn></math> تمثل الموقع</p>`;
const alternatingInlineInput = `<p dir="rtl">الناتج <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math> يساوي <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>y</mi></math> تقريبًا</p>`;

const output = preprocessHtmlForRender(input);
const multilineOutput = preprocessHtmlForRender(multilineMathInput);
const inlineRtlOutput = preprocessHtmlForRender(inlineRtlMathInput);
const adjacentMathArabicOutput = preprocessHtmlForRender(adjacentMathArabicInput);
const lambdaShouldUseWiris = shouldUseWirisForHtml(lambdaInlineRtlInput, true);
const alternatingInlineOutput = preprocessHtmlForRender(alternatingInlineInput);

assert.match(
    output,
    /<span class="math-text-run" dir="rtl">[\s\S]*المتوسِّطُ تقريبًا[\s\S]*<\/span>/,
    'Arabic sentence-like MathML should be converted into normal HTML text for wrapping'
);

assert.match(
    output,
    /<p>فقرة خارج المعادلة<\/p>/,
    'HTML paragraph content outside math should remain intact'
);

assert.doesNotMatch(
    output,
    /<mi>&#1575;&#1604;&#1605;&#1578;&#1608;&#1587;&#1617;&#1616;&#1591;&#1615; &#1578;&#1602;&#1585;&#1610;&#1576;&#1611;&#1575;<\/mi>/,
    'Arabic-only mi nodes should no longer remain as raw mi tokens'
);

assert.match(
    multilineOutput,
    /<div class="math-multiline">[\s\S]*<math[\s\S]*a[\s\S]*<\/math>[\s\S]*<math[\s\S]*c[\s\S]*<\/math>[\s\S]*<\/div>/,
    'MathML with explicit newline markers should be split into stacked math lines'
);

assert.match(
    inlineRtlOutput,
    /<span class="inline-math-rtl" dir="rtl"><math[\s\S]*<mi>x<\/mi><mo>\+<\/mo><mn>1<\/mn>[\s\S]*<\/math><\/span>/,
    'Inline math inside RTL text should be wrapped in an RTL inline container'
);

assert.match(
    adjacentMathArabicOutput,
    /<p dir="rtl"><span class="inline-math-rtl" dir="rtl"><math[\s\S]*<mi>s<\/mi><mi>e<\/mi><mi>c<\/mi>[\s\S]*<\/math><\/span>المطلوب هو(?:&nbsp;|\s)*<\/p>/,
    'A single inline math block should preserve authored sequence and only be isolated, not reordered'
);

assert.equal(
    lambdaShouldUseWiris,
    true,
    'Single inline non-Arabic math inside RTL text should use WIRIS to avoid native Lambda MathML vertical layout'
);

assert.match(
    alternatingInlineOutput,
    /<span class="rtl-mixed-inline-run" dir="rtl">[\s\S]*الناتج[\s\S]*<span class="inline-math-rtl" dir="rtl"><math[\s\S]*<mi>x<\/mi>[\s\S]*<\/math><\/span>[\s\S]*يساوي[\s\S]*<span class="inline-math-rtl" dir="rtl"><math[\s\S]*<mi>y<\/mi>[\s\S]*<\/math><\/span>[\s\S]*تقريبًا[\s\S]*<\/span>/,
    'Alternating Arabic and math segments should be grouped into one RTL mixed-content run'
);

assert.doesNotMatch(
    inlineRtlOutput,
    /rtl-mixed-inline-run/,
    'A single inline math block inside RTL text should not be wrapped as a multi-math mixed-content run'
);

console.log('preprocess-mathml.test.js passed');
