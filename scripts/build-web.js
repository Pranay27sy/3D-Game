// Copies the game into www/, the folder Capacitor packages into the app.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const item of ['index.html', 'css', 'js', 'vendor']) {
  fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
}
console.log('Web build ready in www/');
