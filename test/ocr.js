const ocr = require('../cases/ocr.js');
require('dotenv').load();

async function main() {
  await ocr(process.env.OCR_TEST_PATH);
}

main();
