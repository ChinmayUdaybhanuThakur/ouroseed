import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dest = root + 'dist/';
await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
for (const file of ['index.html', 'style.css', 'src', 'examples', 'docs', 'LICENSE']) {
  await cp(root + file, dest + file, { recursive: true });
}
console.log('Built static browser app in dist/ (no bundler or dependencies).');
