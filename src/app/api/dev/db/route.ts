/**
 * The old DB viewer address returned raw JSON — now we redirect to the human-friendly /dev/db page
 * (which fetches its data from /api/dev/db/data). This way the old link no longer shows gibberish.
 */
export function GET(request: Request) {
  return Response.redirect(new URL("/dev/db", request.url), 307);
}
