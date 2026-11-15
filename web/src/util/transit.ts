// Launch to landing. The team has not fixed a transit time (backend/docs/WEBSITE_API.md, decision 1),
// so the website sends this figure, our estimate, with every POST /evaluate and labels it on screen.
// The landing time itself is always read from the answer's `landing_utc`: nothing adds it locally.

/** Transit from launch to landing, days. Our estimate. */
export const TRANSIT_DAYS = 5;
