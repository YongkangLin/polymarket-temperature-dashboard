# Polymarket Temperature Tracker

Static GitHub Pages dashboard for five Polymarket temperature markets:

- NYC Central Park (`KNYC`) on 2026-06-07
- Miami International (`KMIA`) on 2026-06-07
- Chicago Midway (`KMDW`) on 2026-06-07
- San Francisco International (`KSFO`) on 2026-06-07
- Los Angeles International (`KLAX`) on 2026-06-08

Each event includes the full bracket set listed on Polymarket. The dashboard has
city, date, and bet-bracket selectors, and the chart compares only two lines:
Polymarket YES price and the model YES probability.

The site is static. Regenerate `assets/data.json` from the private modeling repo,
then push this folder as a public GitHub Pages repository.
