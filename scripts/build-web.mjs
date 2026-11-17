// Copies the website files into www/, which Capacitor bundles into the iPhone app.
// The website itself is served straight from the repository root by GitHub Pages.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
const OUT = 'www';
const FILES = ['index.html', 'privacy.html', 'support.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const DIRS = ['js', 'vendor', 'models', 'videos'];
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT);
for (const f of FILES) if (existsSync(f)) cpSync(f, `${OUT}/${f}`);
for (const d of DIRS) cpSync(d, `${OUT}/${d}`, { recursive: true, filter: (p) => !p.endsWith('README.md') });
console.log('Copied the app into www/');
