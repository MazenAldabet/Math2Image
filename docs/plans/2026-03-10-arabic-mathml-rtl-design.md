# Arabic MathML RTL Design

## Problem

Arabic text entered inside MathType-generated MathML renders in reversed order when converted to an image.

## Decision

Keep the outer capture container RTL-aware, but stop forcing generic Arabic text font and bidi rules onto MathML descendants.

## Implementation

- Use Arabic text fonts on normal HTML content in `#capture`.
- Give `math` elements their own math-oriented font stack.
- Preserve `dir="rtl"` on MathML and apply RTL bidi handling only to Arabic text-bearing MathML nodes such as `mi`, `mtext`, and `ms`.

## Expected Result

Arabic inside `<math dir="rtl">` reads right-to-left like normal Arabic text, while numbers and operators continue to use browser MathML layout.
