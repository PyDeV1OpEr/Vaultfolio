// Renders the Vaultfolio brand SVG to a 1024x1024 PNG for `tauri icon`.
// Icon identity matches the in-app branding: dark rounded square + blue "V".
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = readFileSync('icons-src/app-icon.svg', 'utf8');

await sharp(Buffer.from(svg), { density: 300 })
  .resize(1024, 1024)
  .png({ compressionLevel: 9 })
  .toFile('icons-src/app-icon.png');

console.log('wrote icons-src/app-icon.png');
