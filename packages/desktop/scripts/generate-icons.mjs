// 根据 ADR-017 从 docs/image/logo/mark.svg 生成桌面图标套件
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../..");
const desktopDir = join(__dirname, "..");
const tempDir = join(repoRoot, ".temp", "icon-gen");
const svgPath = join(repoRoot, "docs", "image", "logo", "mark.svg");

const channels = {
  dev: { bg: "#0a1128", replacements: null },
  prod: { bg: "#0b090d", replacements: null },
  beta: {
    bg: "#f5f0e8",
    replacements: {
      "url(#goldFoil)": "url(#redFoil)",
      "#F6D365": "#c7493a",
      "#d6b34a": "#a03020",
      "#B8860B": "#8a1e1e",
      "#FDA085": "#e06050",
    },
  },
};

const sizes = [
  { name: "32x32.png", w: 32, h: 32 },
  { name: "64x64.png", w: 64, h: 64 },
  { name: "128x128.png", w: 128, h: 128 },
  { name: "128x128@2x.png", w: 256, h: 256 },
  { name: "Square30x30Logo.png", w: 30, h: 30 },
  { name: "Square44x44Logo.png", w: 44, h: 44 },
  { name: "Square71x71Logo.png", w: 71, h: 71 },
  { name: "Square89x89Logo.png", w: 89, h: 89 },
  { name: "Square107x107Logo.png", w: 107, h: 107 },
  { name: "Square142x142Logo.png", w: 142, h: 142 },
  { name: "Square150x150Logo.png", w: 150, h: 150 },
  { name: "Square284x284Logo.png", w: 284, h: 284 },
  { name: "Square310x310Logo.png", w: 310, h: 310 },
  { name: "StoreLogo.png", w: 50, h: 50 },
];

const icoSizes = [16, 24, 32, 48, 64, 128, 256];

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

function escapePs(str) {
  return str.replace(/'/g, "''");
}

async function generateSvg(channel, config) {
  let svg = await readFile(svgPath, "utf8");
  if (config.replacements) {
    for (const [from, to] of Object.entries(config.replacements)) {
      svg = svg.split(from).join(to);
    }
    svg = svg.replace(
      /<linearGradient id="goldFoil"[\s\S]*?<\/linearGradient>/,
      "<linearGradient id=\"redFoil\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c7493a\"/><stop offset=\"0.5\" stop-color=\"#e06050\"/><stop offset=\"1\" stop-color=\"#8a1e1e\"/></linearGradient>"
    );
  }
  const html = "<!DOCTYPE html>\n" +
    "<html><head><meta charset=\"utf-8\"><style>\n" +
    "body{margin:0;width:512px;height:512px;background:" + config.bg + ";display:flex;justify-content:center;align-items:center}\n" +
    "</style></head><body>\n" +
    svg +
    "\n</body></html>";
  const htmlPath = join(tempDir, "icon-" + channel + ".html");
  await writeFile(htmlPath, html);
  return htmlPath;
}

async function screenshot(htmlPath, outPng) {
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const fileUrl = "file:///" + htmlPath.replace(/\\/g, "/");
  await execFileAsync(
    edge,
    [
      "--headless",
      "--disable-gpu",
      "--screenshot=" + outPng,
      "--window-size=512,512",
      "--hide-scrollbars",
      "--no-sandbox",
      fileUrl,
    ],
    { timeout: 30000 }
  );
}

async function resizeAll(srcPng, outDir) {
  const sizeTable = sizes
    .map((s) => "@('" + s.name + "'," + s.w + "," + s.h + ")")
    .join(",");
  const psScript = [
    "Add-Type -AssemblyName System.Drawing",
    "$src = [System.Drawing.Image]::FromFile('" + escapePs(srcPng) + "')",
    "$sizes = @(" + sizeTable + ")",
    "foreach ($s in $sizes) {",
    "  $dst = New-Object System.Drawing.Bitmap($s[1], $s[2])",
    "  $g = [System.Drawing.Graphics]::FromImage($dst)",
    "  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
    "  $g.DrawImage($src, 0, 0, $s[1], $s[2])",
    "  $dst.Save((Join-Path '" + escapePs(outDir) + "' $s[0]), [System.Drawing.Imaging.ImageFormat]::Png)",
    "  $g.Dispose(); $dst.Dispose()",
    "}",
    "$src.Dispose()",
  ].join("\n");
  await execFileAsync("powershell.exe", ["-NoProfile", "-Command", psScript], {
    timeout: 60000,
  });
}

async function createIco(srcPng, outIco) {
  const sizeList = icoSizes.join(",");
  const psScript = [
    "Add-Type -AssemblyName System.Drawing",
    "$src = [System.Drawing.Image]::FromFile('" + escapePs(srcPng) + "')",
    "foreach ($sz in @(" + sizeList + ")) {",
    "  $dst = New-Object System.Drawing.Bitmap($sz, $sz)",
    "  $g = [System.Drawing.Graphics]::FromImage($dst)",
    "  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
    "  $g.DrawImage($src, 0, 0, $sz, $sz)",
    "  $dst.Save((Join-Path '" + escapePs(tempDir) + "' (\"ico-\" + $sz + \".png\"))", [System.Drawing.Imaging.ImageFormat]::Png)",
    "  $g.Dispose(); $dst.Dispose()",
    "}",
    "$src.Dispose()",
  ].join("\n");
  await execFileAsync("powershell.exe", ["-NoProfile", "-Command", psScript], {
    timeout: 60000,
  });

  const pngBuffers = [];
  for (const sz of icoSizes) {
    const buf = await readFile(join(tempDir, "ico-" + sz + ".png"));
    pngBuffers.push(buf);
  }

  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = [];
  const data = [];
  let offset = 6 + 16 * count;

  for (const buf of pngBuffers) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    const size = buf.length;
    const entry = Buffer.alloc(16);
    entry.writeUInt8(w > 255 ? 0 : w, 0);
    entry.writeUInt8(h > 255 ? 0 : h, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(size, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    data.push(buf);
    offset += size;
  }

  const ico = Buffer.concat([header, ...entries, ...data]);
  await writeFile(outIco, ico);
}

async function main() {
  await ensureDir(tempDir);
  for (const [channel, config] of Object.entries(channels)) {
    console.log("Generating " + channel + "...");
    const outDir = join(desktopDir, "icons", channel);
    await ensureDir(outDir);

    const htmlPath = await generateSvg(channel, config);
    const png512 = join(tempDir, "icon-" + channel + "-512.png");
    await screenshot(htmlPath, png512);

    await writeFile(join(outDir, "icon.png"), await readFile(png512));
    await writeFile(join(outDir, "dock.png"), await readFile(png512));

    await resizeAll(png512, outDir);
    await createIco(png512, join(outDir, "icon.ico"));

    console.log("Done " + channel);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});