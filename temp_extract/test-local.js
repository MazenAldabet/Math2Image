// test-local.js
import { handler } from './index.js';

const event = {
    html: `<div style='padding:20px;font-size:24px;'>
    <p>Hello Mazen</p>
    <math xmlns="http://www.w3.org/1998/Math/MathML/">
    <mfrac>
      <mrow><mo>&#160;</mo><mn>1</mn></mrow>
      <mn>25</mn>
    </mfrac>
  </math>
    <p>Ahlan</p>
    </div>`,
    storage: "local",
    key: "test.png"
};

handler(event).then(console.log);
