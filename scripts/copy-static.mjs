import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist/assets', { recursive: true });
await cp('public', 'dist', { recursive: true });
await cp('src/style.css', 'dist/assets/style.css');
const html = (await readFile('index.html','utf8')).replace('/src/main.ts','./assets/main.js').replace('./src/style.css','./assets/style.css');
await writeFile('dist/index.html',html);
await writeFile('dist/.nojekyll','');
console.log('Built static TypeScript dashboard in dist/');
