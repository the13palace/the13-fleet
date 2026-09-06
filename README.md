# The 13 Palace Fleet — Frontend V1

## Files
- `index.html`
- `styles.css`
- `app.js`
- `config.js`

## Setup
1. Open `config.js`.
2. Paste your own Supabase Project URL.
3. Paste your Supabase publishable/anon key.
4. Do **not** use the service-role key.
5. Upload all four files to the root of your GitHub repository.
6. Enable GitHub Pages for the repository.

## What V1 already does
- Supabase email/password login
- Reads the logged-in user from `public.app_users`
- Shows role badge
- Dashboard counts
- Today's trip list
- Fleet vehicle list
- Basic new-booking form
- Logout

## Important
The booking form does not yet geocode pickup/destination into latitude/longitude.
That will be connected to Mapbox in the next frontend phase.
