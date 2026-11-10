export const PRIVACY_PATH = "/privacy";

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy policy</title>
<style>
  html { height: 100%; }
  body {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    margin: 0;
    background: #ffffff;
    color: #222222;
    font-family: Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
  }
  header, footer { background: #148280; color: #ffffff; }
  .wrap {
    box-sizing: border-box;
    width: 100%;
    max-width: 40rem;
    margin: 0 auto;
    padding-left: 16px;
    padding-right: 16px;
  }
  .band {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 20px;
    padding-bottom: 20px;
  }
  h1 {
    margin: 0;
    color: #ffffff;
    font-size: 16px;
    font-weight: 600;
    line-height: 20px;
  }
  .mark {
    display: block;
    flex: none;
    width: 8px;
    height: 8px;
    background: #ffffff;
    transform: rotate(45deg);
  }
  main {
    flex: 1 0 auto;
    padding-top: 32px;
    padding-bottom: 32px;
  }
  .page-title {
    margin: 0 0 8px;
    padding-bottom: 8px;
    border-bottom: 2px solid #148280;
    color: #111827;
    font-size: 28px;
    font-weight: 600;
    line-height: 34px;
  }
  main p { margin: 0 0 16px; }
  ul { margin: 0 0 16px; padding-left: 1.25rem; }
  li { margin: 0 0 4px; }
  h2 {
    margin: 32px 0 8px;
    padding-bottom: 8px;
    border-bottom: 2px solid #148280;
    color: #151618;
    font-size: 16px;
    font-weight: 600;
    line-height: 22px;
  }
  footer p {
    margin: 0;
    padding-top: 24px;
    padding-bottom: 24px;
    color: #f9fafb;
    font-size: 14px;
    line-height: 20px;
    text-align: left;
  }
  @media (min-width: 1024px) {
    .wrap { max-width: 48rem; }
  }
  @media (forced-colors: active) {
    header, footer { background: Canvas; color: CanvasText; }
    h1, footer p { color: CanvasText; }
    .mark {
      background: CanvasText;
      border: 1px solid CanvasText;
    }
    .page-title, h2 { border-bottom-color: CanvasText; }
  }
</style>
</head>
<body>
<header>
<div class="wrap band">
<span class="mark" aria-hidden="true"></span>
<h1>Red Storm Professor Ratings</h1>
</div>
</header>
<main class="wrap">
<p class="page-title">Privacy Policy</p>
<p>The short version: Red Storm only looks up public professor ratings. It never sees or collects your student ID, class schedule, grades, passwords, or login information, and nothing is ever sold.</p>
<h2>What Red Storm looks at</h2>
<p>When you search for classes, Red Storm reads three things from each row on the page: the instructor’s name, the campus, and the subject. It uses only those three details to find that instructor’s public rating on RateMyProfessors.com. It does not read anything else on the page.</p>
<p>Those details go to a small service we run to do the lookup (we call it “the worker”). If the worker doesn’t already have the rating saved, it asks RateMyProfessors.com for it using only the instructor’s last name and your school.</p>
<h2>A random ID, not your identity</h2>
<p>Each installation of Red Storm creates a random ID, like a made-up serial number. It’s used for one reason: to stop any single install from sending too many requests. It isn’t connected to you, your student record, or your name, and it isn’t saved alongside any rating. The counters that use it reset within minutes.</p>
<h2>How long results are saved (cached)</h2>
<p>To make lookups faster and avoid asking RateMyProfessors.com repeatedly, results are saved temporarily:</p>
<ul>
<li>Professors who have a rating: saved for 7 days.</li>
<li>Professors with no rating or no listing: saved for 24 hours.</li>
</ul>
<p>This happens in two places: on our worker, and in your browser’s local extension storage. When we release an update that changes how results are saved, your browser’s saved ratings are cleared and refreshed automatically.</p>
<h2>What Red Storm never collects</h2>
<ul>
<li>Your student ID</li>
<li>Your class schedule</li>
<li>Your grades</li>
<li>Cookies</li>
<li>Login or authentication tokens</li>
</ul>
<p>We never sell your data.</p>
<h2>Chrome Web Store compliance</h2>
<p>Red Storm’s use of information follows the Chrome Web Store User Data Policy, including its Limited Use requirements.</p>
</main>
<footer>
<div class="wrap">
<p>Unofficial. Not affiliated with St. John's University, Rate My Professors, or Ellucian.</p>
</div>
</footer>
</body>
</html>
`;

export function privacyResponse(): Response {
  return new Response(PAGE, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy":
        "default-src 'none'; style-src 'sha256-9/M6m21YaPHQZdhygRz4raq20K9xnl/8qW4HgICjCJ8='; img-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
