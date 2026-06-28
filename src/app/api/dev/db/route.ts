/**
 * Старый адрес смотрелки БД был сырым JSON — теперь перекидываем на человеческую страницу /dev/db
 * (данные она берёт с /api/dev/db/data). Так старая ссылка не показывает «гиббериш».
 */
export function GET(request: Request) {
  return Response.redirect(new URL("/dev/db", request.url), 307);
}
