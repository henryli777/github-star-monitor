import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'output', 'release');
const publicDir = join(root, 'public');
const names = (await readdir(publicDir)).filter((name) => /\.(mjs|css)$/.test(name)).sort();
const contents = new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(publicDir, name), 'utf8')])));
const hash = createHash('sha256');
for (const [name, content] of contents) hash.update(name).update('\0').update(content).update('\0');
const revision = hash.digest('hex').slice(0, 12);
const assets = new Map(names.map((name) => [name, name.replace(/\.(mjs|css)$/, `.${revision}.$1`)]));

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['Dockerfile', 'compose.yaml', '.dockerignore', 'package.json', 'server.mjs', 'lib', 'public', 'deploy']) {
  await cp(join(root, name), join(output, name), { recursive: true });
}
for (const [name, content] of contents) {
  let versioned = content;
  for (const [original, target] of assets) {
    versioned = versioned.replaceAll(`'./${original}'`, `'./${target}'`).replaceAll(`"./${original}"`, `"./${target}"`);
  }
  await writeFile(join(output, 'public', assets.get(name)), versioned);
}
let html = await readFile(join(publicDir, 'index.html'), 'utf8');
for (const [name, target] of assets) html = html.replaceAll(`"/${name}"`, `"/${target}"`);
await writeFile(join(output, 'public', 'index.html'), html);
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
console.log(JSON.stringify({ version, revision, output, assets: Object.fromEntries(assets) }, null, 2));
