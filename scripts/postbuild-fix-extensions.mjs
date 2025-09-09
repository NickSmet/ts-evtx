import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixImports(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fixed = content.replace(
    /from ['"](\.\.[^'\"]*|\.\/[^'\"]*)['"]/g,
    (match, importPath) => {
      if (importPath.endsWith('.js') || importPath.endsWith('.json')) return match;
      return match.replace(importPath, importPath + '.js');
    }
  );
  if (fixed !== content) fs.writeFileSync(filePath, fixed);
}

function walkDir(dir) {
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) walkDir(filePath);
    else if (file.endsWith('.js')) fixImports(filePath);
  }
}

const root = path.join(__dirname, '..');
const mainDist = path.join(root, 'dist');
if (fs.existsSync(mainDist)) walkDir(mainDist);

const msgDist = path.join(root, 'packages', 'ts-evtx-messages', 'dist');
if (fs.existsSync(msgDist)) walkDir(msgDist);

