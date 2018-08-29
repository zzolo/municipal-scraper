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

// Command line options
const argv = require('yargs')
  .usage('\nUsage: node cases/search.js')
  .option('case-id', {
    description: 'Case ID to search for.  Do not use with the --csv option.'
  })
  .option('csv', {
    description:
      'Path to the CSV file for input.  Do not use with the --case-id option.  See the --csv-column for column option.'
  })
  .option('csv-column', {
    description: 'Column to use wih the --csv option.',
    default: 'case_id'
  })
  .option('no-cache', {
    description: 'Turn off the cache.'
  })
  .option('cache', {
    description: 'Time to cache results in seconds',
    default: 60 * 60
  })
  .option('output', {
    description: 'The directory to output results to.',
    default: path.join(__dirname, '..', 'output')
  })
  .option('court-type', {
    description:
      'The court type, defaults to the SCRAPER_CASES_COURT_TYPE environment variable.',
    default: process.env.SCRAPER_CASES_COURT_TYPE
  })
  .option('county-number', {
    description:
      'The county identifier number, should be two digits, defaults to the SCRAPER_CASES_COUNTY_NUMBER environment variable.',
    default: process.env.SCRAPER_CASES_COUNTY_NUMBER
  })
  .option('new', {
    description:
      'Won\'t scrape cases that already have been scraped; specifically checks for the raw HTML file in the case directory.',
    default: false
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
outputDir = path.join(outputDir, 'cases');
fs.mkdirpSync(outputDir);

// Get summary data
let summary = {};
let summaryPath = path.join(outputDir, 'cases.csv');
if (fs.existsSync(summaryPath)) {
  summary = _.mapKeys(
    _.filter(csv.parse(fs.readFileSync(summaryPath, 'utf-8'))),
    'caseId'
  );
}
const summarySave = () => {
  fs.writeFileSync(
    summaryPath,
    csv.format(_.filter(_.map(summary, d => d), 'caseId'))
  );
};

// Get actions
let actions = {};
let actionsPath = path.join(outputDir, 'actions.csv');
if (fs.existsSync(actionsPath)) {
  actions = _.mapKeys(
    _.filter(csv.parse(fs.readFileSync(actionsPath, 'utf-8'))),
    'id'
  );
}
const actionsSave = () => {
  //console.log(actions);
  fs.writeFileSync(actionsPath, csv.format(_.filter(_.map(actions, d => d))));
};

// Check for which input
if (argv.caseId) {
  getCase(argv.caseId);
}
else if (argv.csv) {
  getCases(argv.csv, argv.csvColumn);
}
else {
  console.error('The --case-id or --csv options must be used.');
  process.exit(1);
}

// Get multiple cases
async function getCases(csvPath, csvColumn) {
  // Get csv file
  if (!fs.existsSync(csvPath)) {
    console.error(`Unable to find CSV at "${csvPath}"`);
    process.exit(1);
  }
  let inputCsv = csv.parse(fs.readFileSync(csvPath, 'utf-8'));

  // Check CSV
  if (!inputCsv.length) {
    console.error(`Unable to find any rows in the CSV at "${csvPath}"`);
    process.exit(1);
  }
  if (!inputCsv[0][csvColumn]) {
    console.error(
      `Unable to find the "${csvColumn}" in the CSV at "${csvPath}"`
    );
    process.exit(1);
  }

  // Go through CSV
  for (let rowId in inputCsv) {
    if (inputCsv[rowId][csvColumn]) {
      await getCase(inputCsv[rowId][csvColumn]);
    }
  }
}

// Get a case
async function getCase(caseId) {
  let outputCaseDir = path.join(outputDir, caseId);
  let outputCaseActionsDir = path.join(outputDir, caseId, 'actions');
  let rawOutputHTML = path.join(outputCaseDir, `case.${caseId}.html`);
  fs.mkdirpSync(outputCaseDir);
  fs.mkdirpSync(outputCaseActionsDir);

  return new Promise(async (resolve, reject) => {
    // Check if new
    if (argv.new && fs.existsSync(rawOutputHTML)) {
      console.error(
        `The --new option is used and the ${caseId} case HTML output exists.`
      );
      return resolve();
    }

    console.error(`Getting case${TTL ? '' : ' (cache off)'}: ${caseId}`);
    request(
      {
        ttl: TTL,
        method: 'POST',
        timeout: TIMEOUT,
        url: process.env.SCRAPER_CASES_URL,
        headers: {
          'Cache-Control': 'no-cache'
        },
        auth: {
          user: process.env.SCRAPER_CASES_USERNAME,
          pass: process.env.SCRAPER_CASES_PASSWORD
        },
        form: {
          search: '1',
          from_case_search: '1',
          court_type: argv.courtType || process.env.SCRAPER_CASES_COURT_TYPE,
          county_num:
            argv.countyNumber || process.env.SCRAPER_CASES_COUNTY_NUMBER,
          case_type: caseId.slice(0, 2),
          case_year: caseId.slice(2, 4),
          case_id: caseId.slice(4)
          //client_data=&
          //search: 'Search+Now'
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
        fs.writeFileSync(rawOutputHTML, body.toString());

        // Data parse
        let data = {
          caseId
        };

        // Load up DOM
        const $ = cheerio.load(body.toString());

        // Doesn't come back with an error header, so we need to check for it
        let $error = $('.alert-danger');
        if ($error.length && $error.text()) {
          console.error(
            `Error from search\n===\n${$error.text().trim()}\n====\n`
          );
          console.error(
            `Error searching for ${caseId}, use the --no-cache option to force a re-fetch.`
          );
          reject(new Error(`Error searching for ${caseId}`));
        }

        // Summary
        data.summary = $('#summary')
          .next('.panel')
          .find('.panel-body')
          .text()
          .trim();

        // Parties/attornies
        data.parties = $('#party_attorney')
          .next('.panel')
          .find('.panel-body')
          .text()
          .trim();

        // Offense
        data.parties = $('#offense_info')
          .next('.panel')
          .find('.panel-body')
          .text()
          .trim();

        // Arrresting officer
        data.arrestingOfficers = $('#arresting_officers')
          .next('.panel')
          .find('.panel-body')
          .text()
          .trim();

        // Case schedule
        data.schedule = $('#case_schedule')
          .next('.panel')
          .find('.panel-body')
          .text()
          .trim();

        // Costs (table)
        data.costs = [];
        let $costs = $('#court_costs')
          .next('.panel')
          .find('.table');
        $costs.find('tbody tr').each((i, el) => {
          let $tds = $(el).find('td');
          data.costs.push({
            caseId,
            incurredBy: $($tds[0])
              .text()
              .trim(),
            account: $($tds[1])
              .text()
              .trim(),
            date: moment(
              $($tds[2])
                .text()
                .trim(),
              'MM/DD/YYYY'
            ).format('YYYY-MM-DD'),
            amount: $($tds[3])
              .text()
              .trim()
          });
        });

        // Financial activity
        data.finances = $('#financial_activity')
          .next('.panel')
          .find('.panel-body')
          .text()
          .trim();

        // Actions
        data.actionsRaw = $('#register_of_actions')
          .next('.panel')
          .find('.panel-body')
          .text()
          .trim();
        data.actions = parseActions(data.actionsRaw, caseId);

        // Download images
        let actionLinks = [];
        $('#register_of_actions')
          .next('.panel')
          .find('.panel-body a')
          .each((i, el) => {
            actionLinks.push($(el).attr('href'));
          });
        if (actionLinks && actionLinks.length) {
          console.error(`Downloading images for ${caseId}`);
          for (let a of actionLinks) {
            let id = a.match(/id=([0-9a-z-_]+)&/i)[1];
            try {
              await downloadAction({
                caseId,
                url: a,
                id: id,
                output: outputCaseActionsDir
              });
              console.error(`Downloaded image ${id} for case ${caseId}`);
            }
            catch (e) {
              console.error(
                `There was an error downloading image ${id} for case ${caseId}`
              );
            }
          }
        }

        // Save CSVs
        fs.writeFileSync(
          path.join(outputCaseDir, `case.${caseId}.costs.csv`),
          csv.format(data.costs)
        );
        fs.writeFileSync(
          path.join(outputCaseDir, `case.${caseId}.actions.csv`),
          csv.format(data.actions)
        );
        fs.writeFileSync(
          path.join(outputCaseDir, `case.${caseId}.csv`),
          csv.format([_.omit(data, ['costs', 'actions'])])
        );

        // Save a copy of JSON
        fs.writeFileSync(
          path.join(outputCaseDir, `case.${caseId}.json`),
          JSON.stringify(data, null, '  ')
        );

        // Save actions
        _.each(data.actions, (a, ai) => {
          a.id = `${caseId}-${ai}`;
          actions[a.id] = a;
        });
        actionsSave();

        // Save to summary
        summary[caseId] = _.omit(data, ['costs', 'actions']);
        summarySave();

        resolve(data);
      }
    );
  });
}

// Download an action
async function downloadAction({ caseId, url, id, output }) {
  return new Promise((resolve, reject) => {
    request(
      {
        url,
        ttl: TTL,
        timeout: TIMEOUT,
        headers: {
          'Cache-Control': 'no-cache'
        },
        auth: {
          user: process.env.SCRAPER_CASES_USERNAME,
          pass: process.env.SCRAPER_CASES_PASSWORD
        },
        encoding: null
      },
      (error, response, body) => {
        if (error) {
          return reject(error);
        }

        fs.writeFileSync(path.join(output, `${caseId}_${id}.pdf`), body);
        resolve();
      }
    );
  });
}

// Parse actions
function parseActions(text, caseId) {
  let actions = [];
  let actionReg = /(^|[0-9]+\/[0-9]+\/[0-9]+)(.*)([0-9]+\/[0-9]+\/[0-9]+|$)/gim;
  let parts = text.match(actionReg);

  if (parts) {
    let action = {};

    parts.forEach(p => {
      p = p.trim();
      if (!p) {
        return;
      }

      // Parts to parse
      let beginning = p.match(/^([0-9]+\/[0-9]+\/[0-9]+)(.*)/i);
      let initiated = p.match(/^this\saction\sinitiated\sby\s(.*)/i);
      let image = p.match(/^image\s+id\s+([0-9a-z]+)/i);

      // Start
      if (beginning) {
        actions.push(action);
        action = {
          caseId,
          date: moment(beginning[1], 'MM/DD/YYYY').format('YYYY-MM-DD'),
          type: beginning[2].trim()
        };
      }
      else if (initiated) {
        action.intiated = initiated[1];
      }
      else if (image) {
        action.image = image[1];
      }
      else {
        action.other = action.other ? `${action.other} | ${p}` : p;
      }
    });
  }

  return _.filter(actions, a => a.date);
}
