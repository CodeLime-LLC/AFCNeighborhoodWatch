# AFC Neighborhood Watch

A web app that helps a church identify new homeowners in the neighborhood for outreach. Uses free public property records from the Polk County (Iowa) Assessor.

## Features

- Enter church address with adjustable search radius (1-10 miles)
- Adjustable timeframe for detecting recent home sales (default: 1 month)
- Manual "pull" button or automated monthly scheduled fetch
- Results table with buyer name, address, sale date, price, and distance
- CSV export of results

## Tech Stack

- **Frontend:** React + TypeScript + Tailwind CSS (Vite)
- **Backend:** Firebase Cloud Functions (2nd gen, Node.js)
- **Database:** Firestore
- **Auth:** Firebase Auth (email/password)
- **Hosting:** Firebase Hosting
- **Data Source:** Polk County Assessor bulk CSV exports (free, no API key)
- **Geocoding:** US Census Geocoder (free, no API key)

## Development

```bash
npm install
npm run dev        # Start Vite dev server
npm test           # Run tests
npm run build      # Build for production
```

## Firebase Functions

```bash
cd functions
npm install
npm run build
npm test
```
