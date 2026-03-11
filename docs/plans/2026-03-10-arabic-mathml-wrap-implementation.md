# Arabic MathML Wrap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make long Arabic text inside MathML wrap within the configured width while preserving normal HTML paragraph rendering.

**Architecture:** Preprocess incoming MathML before it is injected into the capture document. Arabic text-only MathML tokens will be converted into text-style MathML with explicit break opportunities, while normal HTML block styling will be restored separately in CSS.

**Tech Stack:** Node.js, Puppeteer, Chromium, MathML, Docker Compose

---

### Task 1: Add a failing preprocessing regression test

**Files:**
- Create: `test/preprocess-mathml.test.js`
- Modify: `package.json`
- Test: `test/preprocess-mathml.test.js`

**Step 1: Write the failing test**

Create a Node-based assertion test that expects Arabic-only `<mi>` nodes to be converted to breakable text-style MathML and preserves non-math HTML paragraphs.

**Step 2: Run test to verify it fails**

Run: `node test/preprocess-mathml.test.js`
Expected: FAIL because the preprocessing helper does not exist yet.

**Step 3: Write minimal implementation**

Add a preprocessing helper in `index.js` and export it for the test.

**Step 4: Run test to verify it passes**

Run: `node test/preprocess-mathml.test.js`
Expected: PASS

### Task 2: Apply the preprocessing in the renderer and restore HTML block styling

**Files:**
- Modify: `index.js`

**Step 1: Use the helper before page content is set**

Transform incoming HTML so Arabic MathML text nodes become breakable text nodes.

**Step 2: Restore visible paragraph styling**

Add explicit block styling for `p`, `div`, and similar content under `#capture` so normal HTML text remains visible below the math block.

**Step 3: Run targeted regression verification**

Run: `docker compose run --build --rm app sh -lc 'timeout 60s node test.js; echo exit:$?'`
Expected: PASS with `output/test.png` regenerated.

### Task 3: Verify generated output

**Files:**
- Output: `output/test.png`

**Step 1: Check the file exists**

Run: `ls -la output/test.png && file output/test.png`

**Step 2: Inspect result**

Confirm the math text wraps within 300px and the paragraph text below the math block remains visible.
