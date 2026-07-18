import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, 'chess-worker.js');
const appPath = path.join(__dirname, 'App.tsx');

// Read the fixed worker code
const workerCode = fs.readFileSync(workerPath, 'utf8');
console.log(`📥 Read chess-worker.js (${workerCode.length} bytes)`);

// Read App.tsx
let appCode = fs.readFileSync(appPath, 'utf8');

// Find the current worker initialization code
const workerInitStart = appCode.indexOf('// Worker initialization');
if (workerInitStart === -1) {
    console.error('❌ Could not find worker initialization section');
    process.exit(1);
}

// Find the end of the worker initialization by looking for the next significant block
const workerInitEnd = appCode.indexOf('console.log("✅ Worker loaded successfully', workerInitStart);
if (workerInitEnd === -1) {
    console.error('❌ Could not find end of worker initialization section');
    process.exit(1);
}

// Encode the worker code as Base64
const encodedWorkerCode = Buffer.from(workerCode, 'utf8').toString('base64');
console.log(`🔒 Encoded worker code (${encodedWorkerCode.length} bytes)`);

// Create the new inline worker code using Base64 encoding
const newInlineWorkerCode = `// Worker initialization - INLINE with Base64 encoding
// Using Base64 to avoid escape issues with multi-line strings
const encodedWorkerCode = '${encodedWorkerCode}';
// 正确解码包含UTF-8字符的Base64字符串
const decodedData = atob(encodedWorkerCode);
const uint8Array = new Uint8Array(decodedData.length);
for (let i = 0; i < decodedData.length; i++) {
    uint8Array[i] = decodedData.charCodeAt(i);
}
const decodedWorkerCode = new TextDecoder('utf-8').decode(uint8Array);
const workerBlob = new Blob([decodedWorkerCode], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(workerBlob);
workerRef.current = new Worker(workerUrl);
URL.revokeObjectURL(workerUrl); // Clean up the URL object
`;

// Replace the existing worker initialization code with the new inline version
const updatedAppCode =
    appCode.substring(0, workerInitStart) +
    newInlineWorkerCode +
    appCode.substring(workerInitEnd);

// Write the updated App.tsx back to disk
fs.writeFileSync(appPath, updatedAppCode, 'utf8');

console.log('✅ Successfully inlined chess-worker.js into App.tsx');
console.log('   Worker code is now embedded as Base64-encoded string');
console.log('   This avoids SecurityError with file:// protocol and escape issues');
