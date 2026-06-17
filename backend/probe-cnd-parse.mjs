import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mod = require('pdf-parse');
console.log('tipo:', typeof mod, '| keys:', Object.keys(mod).slice(0, 10));

const pdfParse = typeof mod === 'function' ? mod : (mod.default ?? mod.parse ?? Object.values(mod).find(v => typeof v === 'function'));
console.log('pdfParse resolvido:', typeof pdfParse);

const dir = join(__dirname, 'uploads', 'certidoes');
const arquivos = readdirSync(dir).filter(f => f.startsWith('cnd-estadual')).sort();
const ultimo = arquivos[arquivos.length - 1];
console.log(`Lendo: ${ultimo}`);

const buf = readFileSync(join(dir, ultimo));
const data = await pdfParse(buf);
console.log(`\nTexto (${data.text.length} chars):\n${data.text}`);
