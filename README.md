## Install

1. Install [Git](https://git-scm.com/)
   - On a Mac, this can be accomplished with [Homebrew](https://brew.sh/): `brew install git`
1. Install [Node](https://nodejs.org/en/)
   - On a Mac, this can be accomplished with [Homebrew](https://brew.sh/): `brew install node`
1. Get code and go into the project: `git clone https://github.com/zzolo/municipal-scraper.git && cd municipal-scraper`
1. Install dependencies: `npm install`

## Config

Set the following environment variables. These can be managed in a [`.env`](https://www.npmjs.com/package/dotenv) file located in the project.

- `SCRAPER_CALENDAR_URL` (required)
- `SCRAPER_CALENDAR_COUNTY`
- `SCRAPER_CASES_URL` (required)
- `SCRAPER_CASES_USERNAME` (required)
- `SCRAPER_CASES_PASSWORD` (required)
- `SCRAPER_CASES_COURT_TYPE`
- `SCRAPER_CASES_COUNTY_NUMBER`

## Usage

- Scrape calendar. Uses current date by default. Outputs to `output/calendar/` in this project folder by default.
  - Basic usage `node calender/search.js`
  - Help `node calender/search.js --help`
- Scrape case(es). Outputs to `output/cases/<case-id>` in this project folder by default.
  - Basic usage `node cases/search.js --case-id="XXXXX"`
  - Help `node cases/search.js --help`
