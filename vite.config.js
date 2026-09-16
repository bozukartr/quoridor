import { defineConfig } from 'vite';
import { cpSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(root, 'dist');
function filesUnder(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = resolve(dir, entry.name);
        return entry.isDirectory() ? filesUnder(path) : [path];
    });
}

export default defineConfig({
    base: './',
    publicDir: false,
    build: {
        rollupOptions: {
            input: {
                main: resolve(root, 'index.html'),
                profile: resolve(root, 'profile.html'),
                howto: resolve(root, 'howto.html')
            }
        }
    },
    plugins: [{
        name: 'quoridor-offline-assets',
        closeBundle() {
            for (const name of ['assets/sounds', 'logo.png', 'manifest.json']) {
                cpSync(resolve(root, name), resolve(output, name), { recursive: true });
            }
            for (const name of ['index.html', 'profile.html', 'howto.html']) {
                const path = resolve(output, name);
                const html = readFileSync(path, 'utf8').replace(/href="[^"]*manifest[^"]*\.json"/g, 'href="./manifest.json"');
                writeFileSync(path, html);
            }
            const files = filesUnder(output).filter(path => !path.endsWith('/sw.js')).sort();
            const hash = createHash('sha256');
            for (const path of files) hash.update(relative(output, path)).update(readFileSync(path));
            const precache = files.map(path => './' + relative(output, path).replaceAll('\\', '/'));
            const source = readFileSync(resolve(root, 'sw.js'), 'utf8')
                .replace('__BUILD_ID__', hash.digest('hex').slice(0, 12))
                .replace('/* __PRECACHE__ */ []', JSON.stringify(precache));
            writeFileSync(resolve(output, 'sw.js'), source);
        }
    }]
});
