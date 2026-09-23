/* Fill in after deploying the Apps Script collector (see remote/README.md). */
window.STUDY_CONFIG = {
  endpoint: "https://script.google.com/macros/s/AKfycbwlOE3ZZW8ZiRug5w_YxHOjkA0cajMrln62erC51OQApA2kw2PsCbtrtq099rlLzm__/exec",            /* Apps Script web app URL ending in /exec. Empty = answers stay in the browser only. */
  site_key: "",            /* optional shared key, must match SITE_KEY in Code.gs */
  comparisons: { "default": 20 },   /* comparisons per source and question; 8 sources x 20 = 160 per rater */
  epoch: "launch-2026-09-23-v2",   /* change this to discard every browser's saved runs and unsent answers */
  version: "20260923110618"   /* bumped by remote/bump_version.py on each deploy (cache busting) */
};
