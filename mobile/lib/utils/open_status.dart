/// Хвост строки «Открыто · до 22:00» — как на сайте
/// (`web/src/components/catalog/OpenStatusBadge.tsx`). Один источник для
/// карточки выдачи, карточки заведения и превью партнёра.
String openUntilSuffix(String closingTime) => ' · до $closingTime';
