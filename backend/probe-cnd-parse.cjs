const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const pdfParse = require('pdf-parse');

const dir = join(__dirname, 'uploads', 'certidoes');
const arquivos = readdirSync(dir).filter(f => f.startsWith('cnd-estadual')).sort();
const ultimo = arquivos[arquivos.length - 1];
console.log('Lendo:', ultimo);

const buf = readFileSync(join(dir, ultimo));
pdfParse(buf).then(data => {
  console.log(`\nTexto (${data.text.length} chars):\n${data.text}`);
}).catch(console.error);
