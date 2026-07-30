import { pdflib } from './lib.js';

/**
 * Pages carry a /Rotate entry that viewers apply at display time, but pdf-lib
 * draws in the unrotated coordinate space underneath it. Everything the user
 * points at is in *visual* space — what they can see — so these helpers convert
 * between the two. Without them, a footer on a rotated scan lands in the margin
 * and reads sideways.
 *
 * Visual space: origin bottom-left of the page as displayed, y upwards.
 */

export function pageAngle(page) {
  const a = page.getRotation?.().angle ?? 0;
  return ((Math.round(a / 90) * 90) % 360 + 360) % 360;
}

/** Page size as the reader sees it. */
export function visualSize(page) {
  const { width, height } = page.getSize();
  return pageAngle(page) % 180 === 0 ? { width, height } : { width: height, height: width };
}

/** Visual point → user-space point for drawing. */
export function toUser(page, vx, vy) {
  const { width: W, height: H } = page.getSize();
  switch (pageAngle(page)) {
    case 90: return { x: W - vy, y: vx };
    case 180: return { x: W - vx, y: H - vy };
    case 270: return { x: vy, y: H - vx };
    default: return { x: vx, y: vy };
  }
}

/** User-space point → visual point. */
export function toVisual(page, x, y) {
  const { width: W, height: H } = page.getSize();
  switch (pageAngle(page)) {
    case 90: return { x: y, y: W - x };
    case 180: return { x: W - x, y: H - y };
    case 270: return { x: H - y, y: x };
    default: return { x, y };
  }
}

/**
 * Rotation to pass to pdf-lib so content drawn at a visual anchor comes out
 * upright once the viewer applies the page rotation.
 */
export async function uprightRotation(page, extraDegrees = 0) {
  const { degrees } = await pdflib();
  return degrees(pageAngle(page) + extraDegrees);
}

/** Nine-box anchor → visual coordinates inside a box, given content size. */
export function anchorPoint(anchor, box, contentW, contentH) {
  const { x = 0, y = 0, width, height } = box;
  const h = anchor.includes('left') ? 'left' : anchor.includes('right') ? 'right' : 'center';
  const v = anchor.startsWith('top') ? 'top' : anchor.startsWith('bottom') ? 'bottom' : 'middle';
  const px = h === 'left' ? x : h === 'right' ? x + width - contentW : x + (width - contentW) / 2;
  const py = v === 'bottom' ? y : v === 'top' ? y + height - contentH : y + (height - contentH) / 2;
  return { x: px, y: py };
}

/** Hex colour → pdf-lib rgb(). */
export async function hexColor(hex) {
  const { rgb } = await pdflib();
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex).trim());
  if (!m) return rgb(0, 0, 0);
  const s = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return rgb(parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255);
}

export const MM = 2.834645669;
export const IN = 72;

export const mm = (v) => v * MM;
