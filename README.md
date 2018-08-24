## Install

1. Install [Git](https://git-scm.com/)
   - On a Mac, via [Homebrew](https://brew.sh/): `brew install git`
1. Install [Node](https://nodejs.org/en/)
   - On a Mac, via [Homebrew](https://brew.sh/): `brew install node`
1. Get code and go into the project
   - `git clone https://github.com/zzolo/municipal-scraper.git && cd municipal-scraper`
1. Install dependencies: `npm install`

## Config

The following environment variables can be set. You can put these in a [`.env`](https://www.npmjs.com/package/dotenv) file put in the project.

- `SCRAPER_CALENDAR_URL` (required)
- `SCRAPER_CALENDAR_COUNTY`

## Usage

- Calendar scraper. By default will scrape the calendar for today's date, as long as the `SCRAPER_CALENDAR_URL` environment variable is set. Outputs to the an `output` folder in the project by default.
  - Usage: `node calender/search.js --help`
- Case scraper. Scrapes a case or can use a CSV with a `case_id` column, or custom column (see usage). Outputs to the an `output` folder in the project by default.
