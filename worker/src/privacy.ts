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
<p>What is sent, how results are cached, and what is not collected.</p>
<p>In short: Red Storm reads the instructor name, campus, and subject description from a class search row to look up a public rating. It also sends a random installation ID for rate limits. No student id, schedule, grades, cookies, or auth tokens are collected or sold.</p>
<h2>What Is Sent</h2>
<p>Red Storm reads the instructor name, campus, and subject description from a class search row and sends those three fields to look up a public rating. This is done by the service handling lookups, which we call the worker.</p>
<h2>Random Installation ID</h2>
<p>Each install sends a random installation ID used only for rate limits. The ID is not taken from a student record, and the worker does not store it with the rating.</p>
<h2>How Long Results Are Cached</h2>
<p>The worker keeps a shared cache for 7 days for rated profiles and 24 hours for unrated profiles. The browser keeps a 24-hour cache for names that are not found, which we call not_listed names. If cacheVersion changes, local r* entries are dropped.</p>
<h2>What Is Not Collected</h2>
<p>No student id, schedule, grades, cookies, or auth tokens are collected or sold.</p>
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
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
