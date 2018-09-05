/**
 * OCR a file
 */

// Dependencies
const fs = require('fs-extra');
const https = require('https');
const path = require('path');
const OCR = require('../lib/ocrsdk.js');

// Main function
async function ocr(file, options = {}) {
  // Check for file
  if (!fs.existsSync(file)) {
    throw new Error(`Unable to find file: ${file}`);
  }

  // Make output path
  let outputPath =
    path.join(path.dirname(file), path.basename(file, '.pdf')) + '.txt';

  // Check if text file
  if (fs.existsSync(outputPath)) {
    return false;
  }

  // Check config
  if (!process.env.OCR_SDK_APP_ID) {
    throw new Error(
      'In order to OCR, the OCR_SDK_APP_ID environment variable needs to be set.'
    );
  }
  if (!process.env.OCR_SDK_APP_PASS) {
    throw new Error(
      'In order to OCR, the OCR_SDK_APP_PASS environment variable needs to be set.'
    );
  }

  // New promise
  return new Promise((resolve, reject) => {
    // Create ocr object
    const ocr = OCR.create(
      process.env.OCR_SDK_APP_ID,
      process.env.OCR_SDK_APP_PASS
    );

    // Upload image
    ocr.processImage(file, null, (error, response) => {
      if (error) {
        return reject(error);
      }

      // { id: [ 'bf7ccccccccccccccc051025' ],
      // registrationTime: [ '2018-09-05T02:21:26Z' ],
      // statusChangeTime: [ '2018-09-05T02:21:27Z' ],
      // status: [ 'Queued' ],
      // filesCount: [ '1' ],
      // credits: [ '10' ],
      // estimatedProcessingTime: [ '5' ] }

      // Check for ID
      if (!response || !response.id || !response.id[0]) {
        reject(new Error('Response did not contain an ID'));
      }

      // TODO: Pass ID, then wait for it?

      return whenComplete(ocr, response.id[0], outputPath)
        .then(resolve)
        .catch(reject);
    });
  });
}

// Wait for completion
async function whenComplete(ocr, id, outputPath) {
  return new Promise((resolve, reject) => {
    // Wait for completion
    ocr.waitForCompletion(id, (error, complete) => {
      if (error) {
        return reject(error);
      }

      // Make sure result url
      if (!complete || !complete.resultUrl || !complete.resultUrl[0]) {
        return reject(
          new Error(
            'Result URL not provided to response for waiting for completion.'
          )
        );
      }

      // Download
      let outputStream = fs.createWriteStream(outputPath);
      let request = https
        .get(complete.resultUrl[0], download => {
          download.pipe(outputStream);
          download.on('end', () => {
            resolve({
              id
            });
          });
        })
        .on('error', reject);
    });
  });
}

// Export
module.exports = ocr;
