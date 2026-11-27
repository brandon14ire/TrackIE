# TrackIE

A small, installable web app (PWA) that shows live bus departures for your
stop, using the same data as [bustimes.org](https://bustimes.org).

The main screen is your list of saved stops. Tap one to see all of its
departures; **Your stops** takes you back. Until you add a stop, the main
screen says "No stops added yet" with an **Add a stop** button. The first stop
you open is saved for you.

- **Settings** (top right) is where you find stops near you or on a map,
  manage saved stops, and install the app.
- Tap **Save** on a stop to add it to the main screen; tap it again (or the ✕
  on the Settings page) to remove it.
- Buttons for each route with a bus leaving soon filter the board. Every stop
  opens showing all routes.

- Big "next bus" countdown, with live tracking, how many stops away the bus
  is, and whether it's running late.
- The main screen greets you with the date and current weather near your
  first saved stop (icon, temperature and chance of rain) from
  [Open-Meteo](https://open-meteo.com/), free and with no API key.
- Tap the bell on any bus to follow it: a card shows it coming, and you get
  a notification when it's 10 minutes away. This runs in the app, so it needs
  TrackIE open (phones pause web apps in the background).
- Refreshes every 30 seconds while it's open; pauses in the background.
- Works offline: opens instantly and falls back to timetable times.
- Find stops near you, or pick one on a map ([OpenStreetMap](https://www.openstreetmap.org/)
  with [Leaflet](https://leafletjs.com/), loaded only when a map is shown).
- Light and dark mode, screen-reader friendly, no accounts or tracking.

## How it gets the times

Everything runs in the browser, so the app is a plain static site. It reads
the parts of bustimes.org that are open to other websites:

1. **Timetable**: `/api/services/?stops=…` and `/api/trips/?service=…&date=…`
   list today's trips; `/api/trips/<id>/` gives the time each trip reaches
   your stop. Trip times are cached on the phone for a week, so after the
   first visit the app barely touches the timetable API.
2. **Live positions**: `/vehicles.json?service=…` (the feed behind the
   bustimes.org map) gives every tracked bus's trip and delay. Expected time =
   timetabled time + delay. Like bustimes.org, an early bus is shown at its
   timetabled time (drivers wait at timing points) and flagged as "running
   early".

The logic lives in `src/departures.ts` and is covered by unit tests.

bustimes.org is run by one person. The app keeps its requests low: at most a
handful per refresh, only while it's open on screen. Please keep it that way
if you change it.

## Develop

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run build    # type-check and production build into dist/
```

## Deploy to GitHub Pages

1. In the repository on GitHub, go to **Settings → Pages** and set **Source**
   to **GitHub Actions**.
2. Merge to `master` (or run the **Deploy to GitHub Pages** workflow by hand).
   The workflow tests, builds and publishes the site.
3. Open `https://<your-username>.github.io/<repo-name>/` on the phone.

## Install on a phone

- **Android (Chrome)**: open the site, then tap **Install app** on the Settings
  screen, or use the browser menu → **Add to Home screen**.
- **iPhone (Safari)**: tap **Share** → **Add to Home Screen**.

## Credits

Data from [bustimes.org](https://bustimes.org), built on public sector
information (Open Government Licence / NTA open data).
