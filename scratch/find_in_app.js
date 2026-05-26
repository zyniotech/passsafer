const fs = require('fs');
const path = require('path');

const dir = 'c:\\Users\\DOM\\Documents\\Programmieren\\Apps\\PassSafer\\Electron';
const files = ['index.html', 'main.js', 'renderer.js', 'styles.css'];

const terms = [/100\s*device/i, /6-?month/i, /device.*limit/i, /max.*device/i];

files.forEach(file => {
    const filePath = path.join(dir, file);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
            terms.forEach(term => {
                if (term.test(line)) {
                    console.log(`${file}:${idx + 1}: ${line.trim()}`);
                }
            });
        });
    } catch (e) {
        console.error(`Error reading ${file}:`, e.message);
    }
});
