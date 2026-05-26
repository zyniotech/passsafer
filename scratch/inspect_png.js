const fs = require('fs');
const path = require('path');

const dir = 'c:\\Users\\DOM\\Documents\\Programmieren\\Apps\\PassSafer\\Website\\logos';
const files = [
    'correct.png', 'correct1.png',
    'wrong.png', 'wrong1.png',
    'danger.png', 'danger1.png',
    'star.png', 'star1.png'
];

files.forEach(file => {
    const filePath = path.join(dir, file);
    try {
        const buffer = fs.readFileSync(filePath);
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        console.log(`${file}: ${width}x${height} (${buffer.length} bytes)`);
    } catch (e) {
        console.error(`Error reading ${file}:`, e.message);
    }
});
