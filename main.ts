// The Passport Page of a Country That Isn't There.
// main.ts — Node 22, no dependencies, no network.
// Draws one invented passport spread (open passport, data page + visa/stamps
// page) as a 1024x720 PNG and writes it to /output/entry.png.
// Everything is procedural: a tiny vector rasteriser, a 5x7 bitmap font,
// a hand-built PNG encoder (zlib deflate + CRC32). Deterministic output:
// the same bytes on every run.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------- canvas
const W = 1024;
const H = 720;

type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

class Canvas {
  w: number;
  h: number;
  px: Uint8Array; // RGB, row-major
  constructor(w: number, h: number, fill: RGB = [255, 255, 255]) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.px[i * 3] = fill[0];
      this.px[i * 3 + 1] = fill[1];
      this.px[i * 3 + 2] = fill[2];
    }
  }
  set(x: number, y: number, c: RGB, a = 1): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = (yi * this.w + xi) * 3;
    if (a >= 1) {
      this.px[i] = c[0];
      this.px[i + 1] = c[1];
      this.px[i + 2] = c[2];
    } else {
      this.px[i] = Math.round(this.px[i] * (1 - a) + c[0] * a);
      this.px[i + 1] = Math.round(this.px[i + 1] * (1 - a) + c[1] * a);
      this.px[i + 2] = Math.round(this.px[i + 2] * (1 - a) + c[2] * a);
    }
  }
  get(x: number, y: number): RGB {
    const xi = Math.max(0, Math.min(this.w - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(this.h - 1, Math.round(y)));
    const i = (yi * this.w + xi) * 3;
    return [this.px[i], this.px[i + 1], this.px[i + 2]];
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c, a);
    }
  }
  // 1px outline of a rectangle (inclusive edges).
  frame(x: number, y: number, w: number, h: number, c: RGB, t = 1, a = 1): void {
    this.rect(x, y, w, t, c, a);
    this.rect(x, y + h - t, w, t, c, a);
    this.rect(x, y, t, h, c, a);
    this.rect(x + w - t, y, t, h, c, a);
  }
  hline(x0: number, x1: number, y: number, c: RGB, a = 1): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = Math.round(x0); x <= Math.round(x1); x++) this.set(x, y, c, a);
  }
  vline(x: number, y0: number, y1: number, c: RGB, a = 1): void {
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = Math.round(y0); y <= Math.round(y1); y++) this.set(x, y, c, a);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= steps; i++) {
      this.set(x0 + (dx * i) / steps, y0 + (dy * i) / steps, c, a);
    }
  }
  // Thick line: draw parallel offsets perpendicular to the segment.
  thickLine(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB, a = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const half = Math.floor(t / 2);
    for (let o = -half; o <= half; o++) {
      this.line(x0 + nx * o, y0 + ny * o, x1 + nx * o, y1 + ny * o, c, a);
    }
  }
  disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const ddx = x - cx;
        const ddy = y - cy;
        if (ddx * ddx + ddy * ddy <= r2) this.set(x, y, c, a);
      }
    }
  }
  ring(cx: number, cy: number, r: number, t: number, c: RGB, a = 1): void {
    for (let k = 0; k < t; k++) {
      const rr = r - k;
      const steps = Math.max(8, Math.floor(2 * Math.PI * rr));
      for (let i = 0; i < steps; i++) {
        const th = (i / steps) * 2 * Math.PI;
        this.set(cx + rr * Math.cos(th), cy + rr * Math.sin(th), c, a);
      }
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const ddx = (x - cx) / rx;
        const ddy = (y - cy) / ry;
        if (ddx * ddx + ddy * ddy <= 1) this.set(x, y, c, a);
      }
    }
  }
  // Scanline fill of a simple polygon (points in order).
  poly(pts: Array<[number, number]>, c: RGB, a = 1): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) {
          this.set(x, y, c, a);
        }
      }
    }
  }
  // Blit another canvas rotated about its centre onto (cx, cy), alpha 0..1.
  blitRotated(src: Canvas, cx: number, cy: number, deg: number, alpha: number): void {
    const th = (deg * Math.PI) / 180;
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const hw = src.w / 2;
    const hh = src.h / 2;
    const corners = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of corners) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let yy = Math.floor(cy + minY); yy <= Math.ceil(cy + maxY); yy++) {
      for (let xx = Math.floor(cx + minX); xx <= Math.ceil(cx + maxX); xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        const sx = Math.round(dx * cos + dy * sin + hw);
        const sy = Math.round(-dx * sin + dy * cos + hh);
        if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
        const i = (sy * src.w + sx) * 3;
        this.set(xx, yy, [src.px[i], src.px[i + 1], src.px[i + 2]], alpha);
      }
    }
  }
}

// Deterministic PRNG (mulberry32) — same output on every run.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ font
// 5x7 bitmap font, rows as 5-bit strings. Passports are set in caps; the
// renderer upper-cases everything, so only capitals, digits and punctuation
// are defined.
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "<": ["00010", "00100", "01000", "10000", "01000", "00100", "00010"],
  ">": ["01000", "00100", "00010", "00001", "00010", "00100", "01000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  '"': ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  "@": ["01110", "10001", "10111", "10101", "10110", "10000", "01110"],
  _: ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
};

function textWidth(text: string, scale: number): number {
  const t = text.toUpperCase();
  if (t.length === 0) return 0;
  return t.length * 6 * scale - scale;
}

function drawText(
  cv: Canvas,
  text: string,
  x: number,
  y: number,
  scale: number,
  c: RGB,
  a = 1,
): void {
  const t = text.toUpperCase();
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of t) {
    const g = FONT[ch] ?? FONT["?"];
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      for (let col = 0; col < 5; col++) {
        if (row[col] === "1") {
          cv.rect(cx + col * scale, cy + r * scale, scale, scale, c, a);
        }
      }
    }
    cx += 6 * scale;
  }
}

// Same as drawText but every glyph is rendered as an outline (hollow).
function drawTextOutline(
  cv: Canvas,
  text: string,
  x: number,
  y: number,
  scale: number,
  c: RGB,
  a = 1,
): void {
  const t = text.toUpperCase();
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of t) {
    const g = FONT[ch] ?? FONT["?"];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] !== "1") continue;
        const on =
          (r > 0 && g[r - 1][col] === "1") ||
          (r < 6 && g[r + 1][col] === "1") ||
          (col > 0 && g[r][col - 1] === "1") ||
          (col < 4 && g[r][col + 1] === "1");
        if (!on) cv.rect(cx + col * scale, cy + r * scale, scale, scale, c, a);
      }
    }
    cx += 6 * scale;
  }
}

// Wrap text to lines of at most maxChars characters, breaking on spaces.
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length === 0) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

// ------------------------------------------------------------------ png
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(cv: Canvas): Buffer {
  const raw = Buffer.alloc((cv.w * 3 + 1) * cv.h);
  for (let y = 0; y < cv.h; y++) {
    raw[y * (cv.w * 3 + 1)] = 0; // filter: none
    raw.set(cv.px.subarray(y * cv.w * 3, (y + 1) * cv.w * 3), y * (cv.w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0);
  ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- palette
const PAPER = hex("#f3ecda");
const PAPER_DARK = hex("#e7dcc2");
const INK = hex("#22304f");
const INK_SOFT = hex("#4a5878");
const GOLD = hex("#a8842c");
const GOLD_SOFT = hex("#c9a95c");
const RED_SEAL = hex("#8f2f2a");
const BLUE_STAMP = hex("#274b8f");
const PURPLE_STAMP = hex("#5b3a7a");
const FAINT = hex("#b9c0cf"); // security-print tint

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
  ];
}

// Fine wavy security lines across a page region (guilloche feel).
function guilloche(cv: Canvas, x0: number, y0: number, x1: number, y1: number, c: RGB, a: number): void {
  const rnd = rng(777);
  for (let y = y0 + 6; y < y1 - 4; y += 7) {
    const amp = 2 + rnd() * 3;
    const ph = rnd() * Math.PI * 2;
    const per = 60 + rnd() * 90;
    for (let x = x0; x < x1; x++) {
      const yy = y + Math.sin((x / per) * Math.PI * 2 + ph) * amp;
      cv.set(x, yy, c, a);
    }
  }
}

// Light paper grain so flat areas do not band.
function grain(cv: Canvas, x0: number, y0: number, x1: number, y1: number, seed: number): void {
  const rnd = rng(seed);
  const n = Math.floor(((x1 - x0) * (y1 - y0)) / 260);
  for (let i = 0; i < n; i++) {
    const x = x0 + Math.floor(rnd() * (x1 - x0));
    const y = y0 + Math.floor(rnd() * (y1 - y0));
    const v = rnd() > 0.5 ? 255 : 120;
    cv.set(x, y, [v, v * 0.96, v * 0.85] as RGB, 0.05);
  }
}

// ------------------------------------------------------- coat of arms
// Shield with three waves and a star — the arms of Nordvayr.
function drawEmblem(cv: Canvas, cx: number, cy: number, s: number): void {
  const w = 46 * s;
  const h = 56 * s;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  // Shield outline.
  cv.poly(
    [
      [x0, y0],
      [x0 + w, y0],
      [x0 + w, y0 + h * 0.62],
      [cx, y0 + h],
      [x0, y0 + h * 0.62],
    ],
    hex("#fdf8ea"),
  );
  cv.line(x0, y0, x0 + w, y0, GOLD, 1);
  cv.line(x0 + w, y0, x0 + w, y0 + h * 0.62, GOLD, 1);
  cv.line(x0 + w, y0 + h * 0.62, cx, y0 + h, GOLD, 1);
  cv.line(cx, y0 + h, x0, y0 + h * 0.62, GOLD, 1);
  cv.line(x0, y0 + h * 0.62, x0, y0, GOLD, 1);
  // Three waves.
  for (let k = 0; k < 3; k++) {
    const wy = y0 + h * (0.42 + k * 0.14);
    for (let x = x0 + 4 * s; x < x0 + w - 4 * s; x++) {
      const yy = wy + Math.sin((x / (9 * s)) * Math.PI) * 2.4 * s;
      cv.set(x, yy, hex("#2e5a8a"), 0.9);
      cv.set(x, yy + 1, hex("#2e5a8a"), 0.55);
    }
  }
  // Star above the waves.
  const sx = cx;
  const sy = y0 + h * 0.22;
  const r1 = 7 * s;
  const r2 = 3 * s;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? r1 : r2;
    pts.push([sx + r * Math.cos(ang), sy + r * Math.sin(ang)]);
  }
  cv.poly(pts, GOLD);
  // Small crown ticks.
  cv.thickLine(x0 + 8 * s, y0 - 3 * s, x0 + 8 * s, y0 - 7 * s, 1.4 * s, GOLD);
  cv.thickLine(cx, y0 - 3 * s, cx, y0 - 8 * s, 1.4 * s, GOLD);
  cv.thickLine(x0 + w - 8 * s, y0 - 3 * s, x0 + w - 8 * s, y0 - 7 * s, 1.4 * s, GOLD);
}

// ------------------------------------------------------------ portrait
// Flat-illustration passport portrait: a Nordvayr woman, dark blonde hair,
// navy jacket, slate-blue studio background. Drawn entirely with code.
function drawPortrait(cv: Canvas, x: number, y: number, w: number, h: number): void {
  const skin = hex("#e9c49b");
  const skinShade = hex("#d9ab7e");
  const skinLight = hex("#f2d3ac");
  const hair = hex("#4a3527");
  const hairLight = hex("#6b4e38");
  const jacket = hex("#2e3a52");
  const jacketDark = hex("#232c40");
  const shirt = hex("#f4efe2");
  const bgTop = hex("#7d90a8");
  const bgBot = hex("#5d6f85");
  const cx = x + w / 2;

  // Studio background, vertical gradient.
  for (let yy = 0; yy < h; yy++) {
    const t = yy / h;
    cv.rect(x, y + yy, w, 1, mix(bgTop, bgBot, t));
  }
  // Soft vignette on the backdrop.
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    cv.rect(x, y + Math.floor(t * h), w, 1, bgBot, 0.04 * t);
  }

  // Shoulders / jacket.
  cv.poly(
    [
      [x + w * 0.08, y + h],
      [x + w * 0.16, y + h * 0.82],
      [x + w * 0.30, y + h * 0.74],
      [cx - w * 0.06, y + h * 0.70],
      [cx + w * 0.06, y + h * 0.70],
      [x + w * 0.70, y + h * 0.74],
      [x + w * 0.84, y + h * 0.82],
      [x + w * 0.92, y + h],
    ],
    jacket,
  );
  // Jacket shading + lapels.
  cv.poly(
    [
      [x + w * 0.62, y + h * 0.74],
      [cx + w * 0.06, y + h * 0.70],
      [cx + w * 0.10, y + h],
      [x + w * 0.72, y + h],
    ],
    jacketDark,
    0.55,
  );
  cv.poly(
    [
      [cx - w * 0.10, y + h * 0.70],
      [cx - w * 0.02, y + h * 0.86],
      [cx + w * 0.02, y + h * 0.86],
      [cx + w * 0.10, y + h * 0.70],
    ],
    shirt,
  );
  // Shirt collar.
  cv.poly(
    [
      [cx - w * 0.11, y + h * 0.72],
      [cx, y + h * 0.80],
      [cx - w * 0.02, y + h * 0.86],
      [cx - w * 0.13, y + h * 0.80],
    ],
    shirt,
  );
  cv.poly(
    [
      [cx + w * 0.11, y + h * 0.72],
      [cx, y + h * 0.80],
      [cx + w * 0.02, y + h * 0.86],
      [cx + w * 0.13, y + h * 0.80],
    ],
    shirt,
  );

  // Neck.
  cv.rect(cx - w * 0.075, y + h * 0.58, w * 0.15, h * 0.15, skin);
  cv.rect(cx - w * 0.075, y + h * 0.58, w * 0.15, h * 0.035, skinShade, 0.6);

  // Head.
  const hx = cx;
  const hy = y + h * 0.33;
  const hrx = w * 0.185;
  const hry = h * 0.235;
  cv.ellipse(hx, hy, hrx, hry, skin);
  // Jaw taper: overlay background-coloured wedges at the lower sides.
  cv.poly(
    [
      [hx - hrx, hy + hry * 0.28],
      [hx - hrx * 0.55, hy + hry * 0.98],
      [hx - hrx * 0.92, hy + hry * 0.86],
    ],
    bgBot,
    0.0,
  );
  // Cheek shading (right side) + highlight (left).
  cv.ellipse(hx + hrx * 0.55, hy + hry * 0.10, hrx * 0.42, hry * 0.55, skinShade, 0.18);
  cv.ellipse(hx - hrx * 0.55, hy - hry * 0.05, hrx * 0.38, hry * 0.5, skinLight, 0.25);
  // Ears.
  cv.ellipse(hx - hrx * 0.98, hy + hry * 0.05, w * 0.028, h * 0.045, skin);
  cv.ellipse(hx + hrx * 0.98, hy + hry * 0.05, w * 0.028, h * 0.045, skin);

  // Hair: back mass, then the parted front framing the face.
  cv.ellipse(hx, hy - hry * 0.18, hrx * 1.12, hry * 0.95, hair);
  // Shoulder-length sides.
  cv.poly(
    [
      [hx - hrx * 1.10, hy - hry * 0.30],
      [hx - hrx * 0.72, hy - hry * 0.30],
      [hx - hrx * 0.80, hy + hry * 0.75],
      [hx - hrx * 0.95, hy + hry * 1.15],
      [hx - hrx * 1.18, hy + hry * 0.95],
    ],
    hair,
  );
  cv.poly(
    [
      [hx + hrx * 1.10, hy - hry * 0.30],
      [hx + hrx * 0.72, hy - hry * 0.30],
      [hx + hrx * 0.80, hy + hry * 0.75],
      [hx + hrx * 0.95, hy + hry * 1.15],
      [hx + hrx * 1.18, hy + hry * 0.95],
    ],
    hair,
  );
  // Face opening: skin over the hair mass.
  cv.ellipse(hx, hy + hry * 0.06, hrx * 0.92, hry * 0.88, skin);
  cv.ellipse(hx + hrx * 0.45, hy + hry * 0.12, hrx * 0.35, hry * 0.5, skinShade, 0.16);
  // Hairline: the top edge of the face opening is the hairline itself —
  // a smooth curve following the head, with a centre parting.
  cv.poly(
    [
      [hx - hrx * 0.10, hy - hry * 0.86],
      [hx + hrx * 0.06, hy - hry * 0.84],
      [hx + hrx * 0.02, hy - hry * 0.60],
      [hx - hrx * 0.06, hy - hry * 0.62],
    ],
    skin,
    0.9,
  );
  // Hair sheen strands.
  const strand = hex("#7a5c42");
  cv.thickLine(hx - hrx * 0.75, hy - hry * 0.55, hx - hrx * 0.85, hy + hry * 0.55, 1.2, strand, 0.5);
  cv.thickLine(hx + hrx * 0.80, hy - hry * 0.50, hx + hrx * 0.88, hy + hry * 0.50, 1.2, strand, 0.45);
  cv.thickLine(hx - hrx * 0.30, hy - hry * 0.62, hx - hrx * 0.45, hy - hry * 0.35, 1.2, hairLight, 0.6);

  // Brows.
  const eyeY = hy - hry * 0.02;
  const eyeDX = hrx * 0.42;
  cv.thickLine(hx - eyeDX - hrx * 0.22, eyeY - hry * 0.16, hx - eyeDX + hrx * 0.24, eyeY - hry * 0.18, 2.2, hair, 0.9);
  cv.thickLine(hx + eyeDX - hrx * 0.24, eyeY - hry * 0.18, hx + eyeDX + hrx * 0.22, eyeY - hry * 0.16, 2.2, hair, 0.9);
  // Eyes: white, iris, pupil, lash line.
  for (const sgn of [-1, 1]) {
    const ex = hx + sgn * eyeDX;
    cv.ellipse(ex, eyeY, hrx * 0.17, hry * 0.085, hex("#f7f2e8"));
    cv.disc(ex, eyeY, hrx * 0.085, hex("#3d5a74"));
    cv.disc(ex, eyeY, hrx * 0.045, hex("#1c2733"));
    cv.disc(ex - hrx * 0.02, eyeY - hry * 0.02, hrx * 0.02, hex("#e8eef4"), 0.9);
    cv.thickLine(ex - hrx * 0.17, eyeY - hry * 0.075, ex + hrx * 0.17, eyeY - hry * 0.075, 1.6, hair, 0.85);
  }
  // Nose: soft shadow + base.
  cv.thickLine(hx + hrx * 0.03, hy + hry * 0.05, hx - hrx * 0.02, hy + hry * 0.42, 1.4, skinShade, 0.45);
  cv.thickLine(hx - hrx * 0.10, hy + hry * 0.44, hx + hrx * 0.10, hy + hry * 0.44, 1.4, skinShade, 0.4);
  // Lips.
  const lipY = hy + hry * 0.62;
  const lip = hex("#b06a5e");
  const lipDark = hex("#96544a");
  cv.poly(
    [
      [hx - hrx * 0.26, lipY],
      [hx - hrx * 0.10, lipY - hry * 0.055],
      [hx, lipY - hry * 0.02],
      [hx + hrx * 0.10, lipY - hry * 0.055],
      [hx + hrx * 0.26, lipY],
      [hx + hrx * 0.12, lipY + hry * 0.03],
      [hx, lipY + hry * 0.05],
      [hx - hrx * 0.12, lipY + hry * 0.03],
    ],
    lip,
  );
  cv.line(hx - hrx * 0.24, lipY, hx + hrx * 0.24, lipY, lipDark, 0.8);
  // Blush.
  cv.ellipse(hx - hrx * 0.52, hy + hry * 0.42, hrx * 0.16, hry * 0.09, hex("#d98a76"), 0.18);
  cv.ellipse(hx + hrx * 0.52, hy + hry * 0.42, hrx * 0.16, hry * 0.09, hex("#d98a76"), 0.18);
  // Chin shadow under the lip.
  cv.ellipse(hx, hy + hry * 0.82, hrx * 0.2, hry * 0.06, skinShade, 0.2);

  // Faint film grain over the portrait only.
  const rnd = rng(4242);
  for (let i = 0; i < 260; i++) {
    const px = x + Math.floor(rnd() * w);
    const py = y + Math.floor(rnd() * h);
    cv.set(px, py, [255, 255, 255], 0.05);
  }
}

// ------------------------------------------------ fractional-scale text
// drawText with a non-integer scale (e.g. 1.5 for the MRZ strip).
function drawTextF(cv: Canvas, text: string, x: number, y: number, s: number, c: RGB, a = 1): void {
  const t = text.toUpperCase();
  const cy = Math.round(y);
  for (let i = 0; i < t.length; i++) {
    const g = FONT[t[i]] ?? FONT["?"];
    const cx = Math.round(x + i * 6 * s);
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] !== "1") continue;
        const px0 = Math.floor(col * s);
        const px1 = Math.floor((col + 1) * s);
        const py0 = Math.floor(r * s);
        const py1 = Math.floor((r + 1) * s);
        cv.rect(cx + px0, cy + py0, Math.max(1, px1 - px0), Math.max(1, py1 - py0), c, a);
      }
    }
  }
}

function textWidthF(text: string, s: number): number {
  return text.length * 6 * s - s;
}

function drawCentered(cv: Canvas, text: string, cx: number, y: number, scale: number, c: RGB, a = 1): void {
  drawText(cv, text, cx - textWidth(text, scale) / 2, y, scale, c, a);
}

// ------------------------------------------------------------- stamps
function starPoly(cx: number, cy: number, r1: number, r2: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? r1 : r2;
    pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
  }
  return pts;
}

// Worn ink: punch paper-coloured specks through a stamp canvas.
function grunge(cv: Canvas, seed: number, n: number): void {
  const rnd = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rnd() * cv.w);
    const y = Math.floor(rnd() * cv.h);
    cv.set(x, y, PAPER, 0.55);
    if (rnd() > 0.6) cv.set(x + 1, y, PAPER, 0.4);
  }
}

function rectStamp(country: string, kind: string, port: string, date: string, color: RGB, seed: number): Canvas {
  const cv = new Canvas(220, 96, PAPER);
  cv.frame(4, 4, 212, 88, color, 2);
  cv.frame(9, 9, 202, 78, color, 1);
  drawCentered(cv, country, 110, 14, 2, color);
  drawCentered(cv, kind, 110, 34, 2, color);
  cv.hline(20, 200, 56, color);
  drawCentered(cv, port, 110, 62, 1, color);
  drawCentered(cv, date, 110, 74, 2, color);
  if (textWidth(country, 2) <= 150) {
    cv.poly(starPoly(198, 20, 5, 2.2), color);
    cv.poly(starPoly(22, 20, 5, 2.2), color);
  }
  grunge(cv, seed, 130);
  return cv;
}

function roundStamp(country: string, kind: string, port: string, date: string, color: RGB, seed: number): Canvas {
  const cv = new Canvas(150, 150, PAPER);
  cv.ring(75, 75, 70, 2, color);
  cv.ring(75, 75, 60, 1, color);
  drawCentered(cv, country, 75, 30, 2, color);
  drawCentered(cv, kind, 75, 56, 2, color);
  drawCentered(cv, port, 75, 80, 1, color);
  drawCentered(cv, date, 75, 96, 2, color);
  cv.poly(starPoly(75, 128, 6, 2.6), color);
  grunge(cv, seed, 90);
  return cv;
}

function miniStamp(lines: string[], color: RGB, seed: number): Canvas {
  const cv = new Canvas(120, 52, PAPER);
  cv.frame(3, 3, 114, 46, color, 2);
  drawCentered(cv, lines[0], 60, 8, 1, color);
  drawCentered(cv, lines[1], 60, 20, 1, color);
  drawCentered(cv, lines[2], 60, 32, 1, color);
  grunge(cv, seed, 40);
  return cv;
}

// --------------------------------------------------------------- MRZ
// ICAO Doc 9303 check digits: values 0-9 / A-Z=10-35 / '<'=0, weights 7,3,1.
function mrzValue(ch: string): number {
  if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 55;
  return 0;
}
function mrzCheck(s: string): string {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += mrzValue(s[i]) * w[i % 3];
  return String(sum % 10);
}

function buildMrz(): [string, string] {
  const docNo = "NV4829137";
  const nat = "NVR";
  const dob = "880314";
  const sex = "F";
  const exp = "330612";
  const opt = "<<<<<<<<<<<<<<";
  const dc = mrzCheck(docNo);
  const bc = mrzCheck(dob);
  const ec = mrzCheck(exp);
  const oc = mrzCheck(opt);
  const composite = mrzCheck(docNo + dc + dob + bc + exp + ec + opt + oc);
  const line1 = ("P<NVR" + "SOLBERG<<INGRID<MARIE").padEnd(44, "<");
  const line2 = docNo + dc + nat + dob + bc + sex + exp + ec + opt + oc + composite;
  return [line1, line2];
}

// -------------------------------------------------------------- layout
function field(cv: Canvas, label: string, value: string, x: number, y: number): void {
  drawText(cv, label, x, y, 1, INK_SOFT);
  drawText(cv, value, x, y + 10, 2, INK);
}

function buildSpread(): Canvas {
  const cv = new Canvas(W, H, PAPER);
  grain(cv, 0, 0, W, H, 90210);

  // Outer frame.
  cv.frame(8, 8, W - 16, H - 16, INK, 3);
  cv.frame(14, 14, W - 28, H - 28, GOLD, 1);

  // Security print + gutter shadow.
  guilloche(cv, 22, 22, 500, 698, FAINT, 0.55);
  guilloche(cv, 524, 22, 1002, 698, FAINT, 0.55);
  cv.rect(508, 16, 2, 688, INK, 0.10);
  cv.rect(510, 16, 2, 688, INK, 0.16);
  cv.rect(512, 16, 2, 688, INK, 0.10);
  // Faint compass rose watermark on the visa page.
  cv.ring(764, 470, 92, 1, FAINT, 0.35);
  cv.ring(764, 470, 70, 1, FAINT, 0.30);
  cv.poly(starPoly(764, 470, 58, 10), FAINT, 0.22);

  // ============================ LEFT PAGE — data page ==============
  drawEmblem(cv, 66, 66, 1.0);
  drawText(cv, "REPUBLIC OF NORDVAYR", 106, 34, 3, INK);
  drawText(cv, "PASSPORT - PASSEPORT", 106, 62, 1, INK_SOFT);
  cv.hline(106, 480, 82, GOLD, 0.9);
  drawText(cv, "TYPE P", 106, 90, 1, INK_SOFT);
  drawText(cv, "CODE NVR", 190, 90, 1, INK_SOFT);

  // Portrait.
  cv.frame(36, 118, 158, 200, INK, 2);
  cv.frame(40, 122, 150, 192, GOLD, 1);
  drawPortrait(cv, 41, 123, 148, 190);
  // Portrait caption.
  drawText(cv, "PHOTOGRAPH", 36, 324, 1, INK_SOFT);

  // Data fields, one column, label above value.
  const fx = 216;
  let fy = 122;
  const rows: Array<[string, string]> = [
    ["SURNAME", "SOLBERG"],
    ["GIVEN NAMES", "INGRID MARIE"],
    ["NATIONALITY", "NORDVAYRSK"],
    ["DATE OF BIRTH", "14 MAR 1988"],
    ["PLACE OF BIRTH", "HAVSTRAND"],
    ["SEX", "F"],
    ["DATE OF ISSUE", "12 JUN 2023"],
    ["DATE OF EXPIRY", "12 JUN 2033"],
    ["AUTHORITY", "HAVSTRAND"],
    ["PASSPORT NO.", "NV4829137"],
  ];
  for (const [label, value] of rows) {
    field(cv, label, value, fx, fy);
    fy += 30;
  }

  // Holder's signature under the portrait.
  drawText(cv, "HOLDER'S SIGNATURE", 36, 348, 1, INK_SOFT);
  const rnd = rng(31337);
  let sx = 38;
  const sy = 366;
  for (let x = 38; x < 190; x += 2) {
    const yy = sy + Math.sin((x / 9) * Math.PI) * 3 + (rnd() - 0.5) * 1.6;
    cv.set(x, yy, INK, 0.9);
    cv.set(x, yy + 1, INK, 0.5);
    sx = x;
  }
  void sx;
  drawText(cv, "INGRID SOLBERG", 36, 382, 1, INK);

  // Observations box — the seafaring character of the country.
  cv.frame(36, 420, 456, 158, INK, 1);
  cv.rect(36, 420, 456, 22, INK);
  drawText(cv, "OBSERVATIONS", 48, 427, 1, PAPER);
  const obs = wrapText(
    "HOLDER IS AUTHORISED TO TRAVEL ON THE HAVSTRAND-BERGEN FERRY WITHOUT A SEPARATE SEAMAN'S BOOK. DUPLICATE ISSUED 12 JUN 2023 - PREVIOUS PASSPORT NV3110045 CANCELLED.",
    66,
  );
  let oy = 452;
  for (const line of obs) {
    drawText(cv, line, 48, oy, 1, INK);
    oy += 13;
  }
  drawText(cv, "OCCUPATION: FERRY PURSER - M/V SKARV.", 48, 505, 1, INK);
  drawText(cv, "THIS PASSPORT REMAINS THE PROPERTY OF", 48, 540, 1, INK_SOFT);
  drawText(cv, "THE REPUBLIC OF NORDVAYR.", 48, 553, 1, INK_SOFT);

  // Machine-readable zone.
  const [mrz1, mrz2] = buildMrz();
  cv.rect(24, 600, 476, 88, hex("#fdfaf1"));
  cv.frame(24, 600, 476, 88, INK, 1);
  const mrzX = 24 + (476 - textWidthF(mrz1, 1.5)) / 2;
  drawTextF(cv, mrz1, mrzX, 616, 1.5, INK);
  drawTextF(cv, mrz2, mrzX, 644, 1.5, INK);

  // ============================ RIGHT PAGE — visas / stamps ========
  drawText(cv, "VISAS", 540, 30, 3, INK);
  drawText(cv, "PAGE 12", 540 + 448 - textWidth("PAGE 12", 1), 38, 1, INK_SOFT);
  cv.hline(540, 988, 58, GOLD, 0.9);

  // Norway visa box.
  cv.frame(540, 66, 448, 130, INK, 2);
  cv.frame(545, 71, 438, 120, GOLD, 1);
  drawText(cv, "VISA", 556, 78, 3, INK);
  drawText(cv, "KINGDOM OF NORWAY", 640, 82, 2, INK);
  const visaRows = [
    "TYPE C - MULTIPLE ENTRIES - 90 DAYS",
    "VALID 24 JUL 2023 - 24 JUL 2024",
    "REMARK: FERRY CREW, M/V SKARV",
    "FEE: NOK 0 - SEAMAN'S WAIVER",
    "ISSUED: BERGEN, 24 JUL 2023",
  ];
  let vy = 112;
  for (const line of visaRows) {
    drawText(cv, line, 556, vy, 1, INK);
    vy += 13;
  }
  // Small red "VISA ISSUED" stamp overlapping the visa box corner.
  const vs = miniStamp(["VISA", "ISSUED", "24 JUL 2023"], RED_SEAL, 5150);
  cv.blitRotated(vs, 930, 178, -9, 0.9);

  // Seaman's endorsement strip — the telling paperwork detail.
  cv.frame(540, 208, 448, 44, GOLD, 1);
  const end = wrapText(
    "ENDORSEMENT: THIS PASSPORT ALSO SERVES AS A SEAMAN'S BOOK FOR VESSELS UNDER 500 GT REGISTERED IN NORDVAYR. - MARITIME AUTHORITY, HAVSTRAND",
    70,
  );
  let ey = 216;
  for (const line of end) {
    drawText(cv, line, 552, ey, 1, INK);
    ey += 13;
  }

  // Stamps: chronological travel history, all after the 12 JUN 2023 issue.
  const stamps: Array<{ cv: Canvas; x: number; y: number; rot: number }> = [
    { cv: rectStamp("NORWAY", "ARRIVAL", "BERGEN", "28 JUL 2023", BLUE_STAMP, 101), x: 650, y: 300, rot: -7 },
    { cv: rectStamp("NORWAY", "DEPARTURE", "BERGEN", "04 AUG 2023", BLUE_STAMP, 202), x: 880, y: 300, rot: 6 },
    { cv: roundStamp("ICELAND", "ARRIVAL", "REYKJAVIK", "19 SEP 2023", RED_SEAL, 303), x: 650, y: 440, rot: 8 },
    { cv: roundStamp("ICELAND", "DEPARTURE", "KEFLAVIK", "26 SEP 2023", RED_SEAL, 404), x: 880, y: 440, rot: -6 },
    { cv: rectStamp("UNITED KINGDOM", "ARRIVAL", "EDINBURGH", "11 MAY 2024", PURPLE_STAMP, 505), x: 650, y: 580, rot: 5 },
    { cv: rectStamp("UNITED KINGDOM", "DEPARTURE", "EDINBURGH", "18 MAY 2024", PURPLE_STAMP, 606), x: 880, y: 580, rot: -8 },
  ];
  for (const s of stamps) cv.blitRotated(s.cv, s.x, s.y, s.rot, 0.88);

  // Footer.
  drawText(cv, "NORDVAYR - 12", 540 + 448 - textWidth("NORDVAYR - 12", 1), 690, 1, INK_SOFT);

  return cv;
}

// ---------------------------------------------------------------- main
function main(): void {
  const cv = buildSpread();
  const png = encodePng(cv);
  if (png.length > 1048576) {
    throw new Error(`entry.png is ${png.length} bytes, over the 1048576 byte limit`);
  }
  const outDir = "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outDir + "/entry.png", png);
  const [mrz1, mrz2] = buildMrz();
  console.log(`wrote /output/entry.png: ${png.length} bytes, ${W}x${H}`);
  console.log(`MRZ line 1 (${mrz1.length} chars): ${mrz1}`);
  console.log(`MRZ line 2 (${mrz2.length} chars): ${mrz2}`);
}

main();
