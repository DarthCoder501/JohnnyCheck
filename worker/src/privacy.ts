export const PRIVACY_PATH = "/privacy";

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy policy</title>
<style>
  body {
    margin: 0;
    background: #ffffff;
    color: #222222;
    font-family: Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
  }
  header { background: #148280; color: #ffffff; }
  .band {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 40rem;
    margin: 0 auto;
    padding: 24px 16px;
  }
  h1 {
    margin: 0;
    color: #ffffff;
    font-size: 20px;
    font-weight: 600;
  }
  .mark {
    display: block;
    flex: none;
    width: 6px;
    height: 6px;
    background: #ffffff;
    transform: rotate(45deg);
  }
  main {
    max-width: 40rem;
    margin: 0 auto;
    padding: 24px 16px 48px;
  }
  h2 {
    margin: 24px 0 8px;
    padding-bottom: 8px;
    border-bottom: 2px solid #148280;
    font-size: 16px;
    font-weight: 600;
  }
  main h2:first-child { margin-top: 0; }
  p { margin: 0 0 12px; }
  @media (forced-colors: active) {
    header { background: Canvas; color: CanvasText; }
    h1 { color: CanvasText; }
    .mark {
      background: CanvasText;
      border: 1px solid CanvasText;
    }
    h2 { border-bottom-color: CanvasText; }
  }
</style>
</head>
<body>
<header>
<div class="band">
<span class="mark" aria-hidden="true"></span>
<h1>Red Storm Professor Ratings</h1>
</div>
</header>
<main>
<h2>What is sent</h2>
<p>Red Storm Professor Ratings reads the instructor name, campus, and subject description from a class search row and sends those three fields to look up a public rating.</p>
<h2>Client id</h2>
<p>Each install sends a random client id used only for rate limits. The id is not taken from a student record, and this worker does not store it with the rating.</p>
<h2>How long a result stays</h2>
<p>The worker keeps a 7-day shared cache for rated profiles and a 24-hour shared cache for unrated profiles. The browser keeps a 24-hour browser cache for not_listed names. A cacheVersion change drops local r* entries.</p>
<h2>What is not collected</h2>
<p>No student id, schedule, grades, cookies, or auth tokens are collected or sold.</p>
</main>
</body>
</html>
`;

export function privacyResponse(): Response {
  return new Response(PAGE, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
