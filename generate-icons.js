#!/usr/bin/env node
// Generates PNG icons from the SVG source (requires: npm install -g sharp-cli,
// or just open icon16.svg in a browser and export as PNG at the needed sizes).

const { execSync } = require('child_process');
const sizes = [16, 48, 128];

for (const s of sizes) {
  try {
    execSync(`npx sharp-cli -i icons/icon16.svg -o icons/icon${s}.png --resize ${s} ${s}`);
    console.log(`icon${s}.png gerado`);
  } catch {
    console.warn(`Não foi possível gerar icon${s}.png automaticamente. Converta icons/icon16.svg manualmente.`);
  }
}
