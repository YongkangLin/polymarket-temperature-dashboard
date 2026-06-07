# Polymarket Temperature Tracker

Static GitHub Pages dashboard for five Polymarket temperature markets:

- NYC Central Park (`KNYC`) on 2026-06-07
- Miami International (`KMIA`) on 2026-06-07
- Chicago Midway (`KMDW`) on 2026-06-07
- San Francisco International (`KSFO`) on 2026-06-07
- Los Angeles International (`KLAX`) on 2026-06-08

The data includes real historical Polymarket temperature events for all five
cities from 2026-04-01 through 2026-06-08. Each event includes the full bracket
set listed on Polymarket. Recent official highs are filled from the NWS Daily
Climatological Report products when the slower archive has not caught up. The
dashboard has city and date selectors. The Polymarket chart shows every bracket
price line for the selected event, and the model chart shows generated model
probabilities where available. Chart x-axes are fixed to the selected station's
official NWS climate-day window; traces stop at their latest available timestamp.

The site is static. Regenerate `assets/data.json` from the private modeling repo,
then push this folder as a public GitHub Pages repository.
