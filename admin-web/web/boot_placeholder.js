// Снимает заглушку «Загружаем панель…» первым кадром Flutter (проход по
// панели модератора, 20.10, пункт A3-27). Отдельным файлом, а не встроенным
// <script>: политика источников панели (Caddyfile, Content-Security-Policy)
// не пускает встроенные скрипты (сверка меток панели 29.10, S2).
window.addEventListener('flutter-first-frame', function () {
  var placeholder = document.getElementById('boot-placeholder');
  if (placeholder) placeholder.remove();
});
