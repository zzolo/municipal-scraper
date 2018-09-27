#!/usr/bin/env node

// Dependencies
const fs = require('fs-extra');
const path = require('path');
const _ = require('lodash');
const request = require('cached-request')(require('request'));
const cheerio = require('cheerio');
const csv = require('d3-dsv').dsvFormat(',');
const moment = require('moment-timezone');
require('dotenv').load();

// Main function
async function main() {
  // Command line options
  const argv = require('yargs')
    .usage('\nUsage: node calender/search.js')
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
    })
    .option('county', {
      description:
        'County code to use, defaults to the SCRAPER_CALENDAR_COUNTY environment variable.',
      default: process.env.SCRAPER_CALENDAR_COUNTY
    })
    .option('date', {
      description:
        'Date to search calendar in format YYYY-MM-DD.  Defaults to current date.',
      default: moment().format('YYYY-MM-DD')
    })
    .option('min-date', {
      description:
        'Minimum date to search calendar in format YYYY-MM-DD (inclusive).  Use this instead of the "date" option.'
    })
    .option('max-date', {
      description:
        'Maximum date to search calendar in format YYYY-MM-DD (inclusive).  Use this instead of the "date" option.'
    }).argv;

  // Request cache
  const cacheDir = path.join(__dirname, '..', '.cache');
  fs.mkdirpSync(cacheDir);
  request.setCacheDirectory(cacheDir);
  const TTL = argv.cache === false ? 0 : parseInt(argv.cache) * 1000;
  const TIMEOUT = 10 * 60 * 1000;

  // Check for config
  if (!process.env.SCRAPER_CALENDAR_URL) {
    throw new Error(
      'Make sure the SCRAPER_CALENDAR_URL environment variable is set.'
    );
  }

  // Today's date
  let now = moment();

  // search date
  let calendarDate = argv.date
    ? moment(argv.date, ['MM/DD/YYYY', 'YYYY-MM-DD'])
    : moment();

  // Min and max data
  let rangeDates = [];
  if (argv.minDate && argv.maxDate) {
    rangeDates[0] = moment(argv.minDate, ['MM/DD/YYYY', 'YYYY-MM-DD']);
    rangeDates[1] = moment(argv.maxDate, ['MM/DD/YYYY', 'YYYY-MM-DD']);
  }

  // Outputs
  let outputDir = argv.output || path.join(__dirname, '..', 'output');
  outputDir = path.join(outputDir, 'calendar');
  fs.mkdirpSync(outputDir);

  // Output all current
  let outputCurrentPath = path.join(outputDir, 'all-cases-recent.csv');
  let outputCurrent = [];
  if (fs.existsSync(outputCurrentPath)) {
    outputCurrent = csv.parse(fs.readFileSync(outputCurrentPath, 'utf-8'));
  }

  // Output all historical
  let outputHistoricalPath = path.join(outputDir, 'all-cases-historical.csv');
  let outputHistorical = [];
  if (fs.existsSync(outputHistoricalPath)) {
    outputHistorical = csv.parse(
      fs.readFileSync(outputHistoricalPath, 'utf-8')
    );
  }

  // Do search
  if (rangeDates && rangeDates.length) {
    for (
      let current = moment(rangeDates[0]);
      current.diff(rangeDates[1], 'days') <= 0;
      current.add(1, 'days')
    ) {
      await searchDate(current);
    }
  }
  else {
    await searchDate(calendarDate);
  }

  // Do a search
  async function searchDate(searchDate) {
    // Output specific date
    let outputByDateDir = path.join(outputDir, searchDate.format('YYYY-MM-DD'));
    fs.mkdirpSync(outputByDateDir);
    let outputByDatePath = path.join(
      outputByDateDir,
      `${now.format('YYYY-MM-DDTHH-mm-ssZZ')}--${searchDate.format(
        'YYYY-MM-DD'
      )}.csv`
    );

    return new Promise((resolve, reject) => {
      // Make request
      console.error(
        `Getting URL${TTL ? '' : ' (cache off)'} for ${searchDate.format(
          'YYYY-MM-DD'
        )}: ${process.env.SCRAPER_CALENDAR_URL}`
      );
      request(
        {
          ttl: TTL,
          method: 'POST',
          timeout: TIMEOUT,
          url: process.env.SCRAPER_CALENDAR_URL,
          headers: {
            'Cache-Control': 'no-cache'
          },
          form: {
            court: 'D',
            countyC: '',
            countyD: argv.county || process.env.SCRAPER_CALENDAR_COUNTY,
            selectRadio: 'date',
            searchField: searchDate.format('MM/DD/YYYY'),
            submitButton: 'Submit'
          }
        },
        (error, response, body) => {
          if (error) {
            console.error(error);
            reject(new Error('Error requesting Calendar URL.'));
          }
          if (response.statusCode >= 300) {
            reject(
              new Error(
                `Status response of Calendar URL: ${response.statusCode}`
              )
            );
          }

          // Data
          let data = [];

          // Cheerio
          const $ = cheerio.load(body.toString());

          // Doesn't come back with an error header, so we need to check for it
          let $error = $('.alert-danger');
          if ($error.length && $error.text()) {
            console.error($error.text());
            console.error(
              `Error searching for ${searchDate}, use the --no-cache option to force a re-fetch.`
            );
            return resolve();
          }

          // Main tables
          $('table.table-condensed').each((i, el) => {
            let $table = $(el);

            // Get heading
            let heading = $table
              .find('thead th[colspan=6]')
              .text()
              .trim();

            // Go through rows
            $table.find('tbody tr').each((i, el) => {
              let $tds = $(el).find('td');
              if (
                !$($tds[5])
                  .text()
                  .trim()
              ) {
                return;
              }

              data.push({
                captureDate: now.toISOString(),
                searchDate: searchDate.format('YYYY-MM-DD'),
                ctrm: heading,
                name: $($tds[0])
                  .text()
                  .trim(),
                date: $($tds[1])
                  .text()
                  .trim(),
                time: $($tds[2])
                  .text()
                  .trim(),
                hearing: $($tds[3])
                  .text()
                  .trim(),
                caption: $($tds[4])
                  .text()
                  .trim(),
                case: $($tds[5])
                  .text()
                  .trim()
              });
            });
          });

          // Output just this pull
          fs.writeFileSync(outputByDatePath, csv.format(data));
          console.error(`Done. Saved this run to: ${outputByDatePath}`);

          // Output all historical
          outputHistorical = outputHistorical.concat(data);
          fs.writeFileSync(outputHistoricalPath, csv.format(outputHistorical));
          console.error(`Done. Saved to all calendar: ${outputHistoricalPath}`);

          // Output all recent
          outputCurrent = _.filter(outputCurrent, r => {
            return r.searchDate !== searchDate.format('YYYY-MM-DD');
          });
          outputCurrent = outputCurrent.concat(data);
          fs.writeFileSync(outputCurrentPath, csv.format(outputCurrent));
          console.error(
            `Done. Saved to all calendar (current): ${outputCurrentPath}`
          );

          resolve();
        }
      );
    });
  }
}

// Do
main();
