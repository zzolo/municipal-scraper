#!/usr/bin/env node

// Dependencies
const fs = require('fs-extra');
const path = require('path');
const _ = require('lodash');
const cheerio = require('cheerio');
const csv = require('d3-dsv').dsvFormat(',');
const moment = require('moment-timezone');
require('dotenv').load();

// Put together throttled and cached request
const throttledRequest = require('throttled-request')(require('request'));
throttledRequest.configure({ requests: 1, milliseconds: 3000 });
const request = require('cached-request')(throttledRequest);

// Command line options
const argv = require('yargs')
  .usage('\nUsage: node names/search.js')
  .option('name', {
    description: 'Name to search for, such as "Smith, John".'
  })
  .option('case-type', {
    description: 'Optional case type to limit.  For example "JV"'
  })
  .option('no-cache', {
    description: 'Turn off the cache.'
  })
  .option('cache', {
    description: 'Time to cache results in seconds',
    default: 60 * 60 * 24
  })
  .option('output', {
    description: 'The directory to output results to.',
    default: path.join(__dirname, '..', 'output')
  }).argv;

// Request cache
const cacheDir = path.join(__dirname, '..', '.cache');
fs.mkdirpSync(cacheDir);
request.setCacheDirectory(cacheDir);
const TTL = argv.cache === false ? 0 : parseInt(argv.cache) * 1000;
const TIMEOUT = 10 * 60 * 1000;

// Check for config
if (!process.env.SCRAPER_CASES_URL) {
  throw new Error(
    'Make sure the SCRAPER_CASES_URL environment variable is set.'
  );
}

// Output
let outputDir = argv.output || path.join(__dirname, '..', 'output');
outputDir = path.join(outputDir, 'names');
fs.mkdirpSync(outputDir);

// Now
let now = moment();

// Do search
searchName(argv);

// Search name`
async function searchName(options) {
  let searchId = _.kebabCase(
    _.filter([options.name, options.caseType]).join(' ')
  );
  let outputSearchHTML = path.join(outputDir, `${searchId}.html`);
  let outputSearchCSV = path.join(outputDir, `${searchId}.csv`);

  // There's an odd behavior where if a download is stopped in the middle,
  // the cached-request handling just fails oddly
  const nameDownloadsPath = path.join(cacheDir, 'name-downloads.json');
  let nameDownloads = {};
  if (fs.existsSync(nameDownloadsPath)) {
    nameDownloads = JSON.parse(fs.readFileSync(nameDownloadsPath, 'utf-8'));
  }

  // If currently downloading, then force re-download
  let caseTTL = TTL;
  if (nameDownloads[searchId]) {
    console.error(
      `Name search ${searchId} did not finish downloading, re-downloading.`
    );
    caseTTL = 0;
  }

  // Mark as download
  nameDownloads[searchId] = true;
  fs.writeFileSync(nameDownloadsPath, JSON.stringify(nameDownloads));

  // Start promise
  return new Promise(async (resolve, reject) => {
    console.error(
      `\nGetting name search${TTL ? '' : ' (cache off)'}: ${searchId}`
    );
    request(
      {
        ttl: caseTTL,
        method: 'POST',
        timeout: TIMEOUT,
        url: process.env.SCRAPER_NAME_URL,
        headers: {
          'Cache-Control': 'no-cache'
        },
        auth: {
          user: process.env.SCRAPER_CASES_USERNAME,
          pass: process.env.SCRAPER_CASES_PASSWORD
        },
        form: {
          submit_hidden: process.env.SCRAPER_NAME_HIDDEN_TOKEN,
          party_name: options.name,
          case_type: options.caseType ? options.caseType : undefined,
          indiv_entity_type: 'individual'
        }
      },
      async (error, response, body) => {
        if (error) {
          console.error(error);
          reject('Error requesting Case URL.');
        }
        if (response.statusCode >= 300) {
          reject(`Status response of Case URL: ${response.statusCode}`);
        }

        // Save a copy of the raw HTML
        fs.writeFileSync(outputSearchHTML, body.toString());

        // Data
        let data = [];

        // Cheerio
        const $ = cheerio.load(body.toString());

        // Doesn't come back with an error header, so we need to check for it
        let $error = $('.alert-danger');
        if ($error.length && $error.text()) {
          console.error($error.text());
          console.error(
            `Error searching for "${
              options.name
            }", use the --no-cache option to force a re-fetch.`
          );
          return resolve();
        }

        // Main table
        $('.panel .table-responsive .table-condensed tbody tr').each(
          (i, el) => {
            let $tds = $(el).find('td');
            let nameCell = $($tds[0])
              .text()
              .trim();

            data.push({
              captureDate: now.toISOString(),
              searchName: options.name,
              searchCaseType: options.caseType,
              name: nameCell
                .replace(/[\s\t\r\n]+/, ' ')
                .replace(/[\s\t\r\n]+/gm, ' ')
                .replace(/(\(.+$)/m, '')
                .trim(),
              partyType: nameCell.match(/\((.+)\)/)
                ? nameCell
                  .match(/\((.+)\)/)[1]
                  .replace(/\s+/, ' ')
                  .trim()
                : '',
              birthdate: nameCell.match(/dob:\s+(.+)$/i)
                ? nameCell
                  .match(/dob:\s+(.+)$/i)[1]
                  .replace(/\s+/, ' ')
                  .trim()
                : '',
              caseNumber: $($tds[1])
                .text()
                .trim()
                .replace(/\s+/g, ''),
              caption: $($tds[2])
                .text()
                .trim(),
              judge: $($tds[3])
                .text()
                .trim(),
              attorney: $($tds[4])
                .text()
                .trim()
            });
          }
        );

        // Update tracking
        nameDownloads[searchId] = false;
        fs.writeFileSync(nameDownloadsPath, JSON.stringify(nameDownloads));

        // Output just this pull
        fs.writeFileSync(outputSearchCSV, csv.format(data));
        console.error(`Done. Saved this run to: ${outputSearchCSV}`);

        resolve();
      }
    );
  });
}
