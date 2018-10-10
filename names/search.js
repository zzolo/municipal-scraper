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
    description: 'Optional, name to search for, such as "Smith, John".'
  })
  .option('case-type', {
    description: 'Optional county code.  For instance 01.'
  })
  .option('case-type', {
    description: 'Optional case type code to limit search.  For instance JV.'
  })
  .option('case-sub-type', {
    description: 'Optional case sub type code.  This is based on the case type.'
  })
  .option('year', {
    description:
      'Optional year.  This should be the last two digits of the year, such as 01 or 98.'
  })
  .option('entity-type', {
    description: 'Entity type to use.',
    default: 'individual'
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
let outputHTMLDir = path.join(outputDir, 'html');
fs.mkdirpSync(outputDir);
fs.mkdirpSync(outputHTMLDir);

// Now
let now = moment();

// Formatting
argv.county = argv.county
  ? argv.county.toString().padStart(2, '0')
  : argv.county;
argv.year = argv.year ? argv.year.toString().padStart(2, '0') : argv.year;

// Do search
searchNamePages(argv);

// Search multiple pages of results
async function searchNamePages(options) {
  options.start = options.start || 0;
  options.save = options.save || false;
  let morePages = true;
  let completeData = [];

  // While we have more pages to do
  while (morePages) {
    let { data, nextStart, pageDescription } = await searchName(options);
    completeData = completeData.concat(data);
    console.error(`Finished: ${pageDescription}`);

    if (nextStart) {
      options.start = nextStart;
      morePages = true;
    }
    else {
      morePages = false;
    }
  }

  // Write output
  options.start = undefined;
  let searchId = `${makeSearchId(options)}-all`;
  let outputData = path.join(outputDir, `${searchId}.csv`);
  fs.writeFileSync(outputData, csv.format(completeData));
  console.error(`Done. Saved full output to: ${outputData}`);
}

// Search name`
async function searchName(options) {
  // Create search ID
  let searchId = makeSearchId(options);
  let outputSearchHTML = path.join(outputHTMLDir, `${searchId}.html`);
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
    // If subtype, but no type
    if (options.caseSubType && !options.caseType) {
      reject(new Error('Cannot use --case-sub-type without a --case-type.'));
    }

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
          start: options.start ? options.start : undefined,
          party_name: options.name ? options.name : undefined,
          year: options.year ? options.year : undefined,
          county_num: options.county ? options.county.toString() : undefined,
          case_type: options.caseType ? options.caseType.toString() : undefined,
          subtype: options.caseSubType
            ? options.caseSubType.toString()
            : undefined,
          indiv_entity_type: options.entityType
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
            `Error searching for "${searchId}", use the --no-cache option to force a re-fetch.`
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
              searchID: searchId,
              searchPageStart: options.start,
              searchName: options.name,
              searchCounty: options.county,
              searchYear: options.year,
              searchCaseType: options.caseType,
              searchCaseSubType: options.caseSubType,
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

        // Determine if there is another page
        let nextStart = false;
        let pageDescription;

        if ($('#page_links').length) {
          // Put together list of starts from links
          let starts = [];
          $('#page_links li input[name="start"]').each((i, el) => {
            starts.push(parseInt($(el).val(), 10));
          });

          // Find where we are
          starts = _.sortBy(starts);
          let currentStart = _.findIndex(
            starts,
            s => s === parseInt(options.start, 10)
          );

          // Determine next one
          if (currentStart === -1 || currentStart >= starts.length - 1) {
            nextStart = false;
          }
          else {
            nextStart = starts[currentStart + 1];
          }

          // Try to get descriptive page
          if ($('.col-sm-12.text-right strong').length) {
            pageDescription = $('.col-sm-12.text-right strong').text();
          }
        }

        // Update tracking
        nameDownloads[searchId] = false;
        fs.writeFileSync(nameDownloadsPath, JSON.stringify(nameDownloads));

        // Output just this pull
        if (options.save) {
          fs.writeFileSync(outputSearchCSV, csv.format(data));
          console.error(`Done. Saved this run to: ${outputSearchCSV}`);
        }

        resolve({
          data,
          nextStart,
          pageDescription
        });
      }
    );
  });
}

// Make search ID based on options
function makeSearchId(options) {
  return _.kebabCase(
    _.filter([
      options.name,
      options.county,
      options.year,
      options.caseType,
      options.caseSubType,
      options.entityType,
      options.start === 0 ? '0' : options.start
    ]).join(' ')
  );
}
