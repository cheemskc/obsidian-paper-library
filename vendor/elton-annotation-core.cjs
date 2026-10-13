/*
 * Adapted from Elton Reader src/main.js, erSelectionRect and _persistHighlights.
 * https://github.com/swayinfo/elton-reader/tree/2753740304096b661e5f6bd8fc66795054847a32
 * Copyright (c) 2026 Elton Labs
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Keep the popup next to visible selected lines, not an empty paragraph box.
function selectionRect(range, areaEl) {
  let rects = [];
  try { rects = [...range.getClientRects()].filter(r => r.width > .5 && r.height > .5); } catch {}
  if (!rects.length) return range.getBoundingClientRect();
  const box = areaEl?.getBoundingClientRect();
  if (box) {
    const seen = rects.filter(r => r.right > box.left + 1 && r.left < box.right - 1
      && r.bottom > box.top && r.top < box.bottom);
    if (seen.length) rects = seen;
  }
  const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right));
  const top = Math.min(...rects.map(r => r.top)), bottom = Math.max(...rects.map(r => r.bottom));
  return { left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top };
}

// Elton's serialized single-edit chain, with errors returned to our retry UI
// rather than swallowed. A failed edit does not poison subsequent edits.
function enqueue(owner, action) {
  const next = (owner.annotationMutationQueue || Promise.resolve()).catch(() => {}).then(action);
  owner.annotationMutationQueue = next;
  return next;
}
module.exports = { selectionRect, enqueue };
