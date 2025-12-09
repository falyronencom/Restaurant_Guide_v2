## Production Readiness Checklist (backend)

### Модули и покрытие
- Reviews: сервис 97.46%, контроллер 100%.  
- Favorites: сервис 100%, контроллер 100%.  
- Establishments: сервис 91.67%, контроллер 100%.  
- Auth/Search из прошлых фаз: ~87% / ~83.9%.  
- Общий проект: ~64% (медиа сознательно не покрыты).

### Известные блокеры
- Исправить 500 на `/api/v1/reviews/:id` (PUT/DELETE) — сейчас `REVIEW_UPDATE_FAILED` / `REVIEW_DELETION_FAILED`. Требуется корректный статус 200/204 и обновление тестов.
- Медиа-интеграция (Cloudinary) без тестов; эндпоинты частично пропущены.

### Мониторинг и алертинг
- Логи: 4xx как warn, 5xx как error; убедиться в экспорте в централизованный лог-стек.  
- Метрики: считать RPS/latency/error-rate по основным маршрутам (auth, search, reviews, favorites, establishments).  
- Квоты: мониторить Redis availability и частоту `RATE_LIMIT_EXCEEDED`.  
- БД: отслеживать deadlocks/slow queries для агрегатов отзывов и списков избранного.

### Тестовая регрессия перед релизом
- `NODE_ENV=test jest --coverage` (приготовленный Redis/DB).  
- Точечные прогоны при изменениях модулей:  
  - Reviews: `src/tests/unit/review*.test.js`, `integration/reviews.test.js`.  
  - Favorites: `unit/favorite*.test.js`, `integration/favorites.test.js`.  
  - Establishments: `unit/establishment*.test.js`, `integration/establishments.test.js`.

### Рекомендации по сопровождению
- Поддерживать покрытие controllers/services ≥75–90% и обновлять пороги по мере стабилизации.  
- Документировать ожидаемые ответы ошибок (коды/структура) в тестах и в API-спеке.  
- Для новых фич использовать паттерн: unit с моками → integration с реальной БД → e2e journey при наличии зависимостей.

### Непокрытые области (принято)
- Media upload/transform (Cloudinary) — добавить тесты после настройки окружения.  
- Низкоуровневые модели media/redis/database: пока частично покрыты, не блокируют релиз при стабильной инфраструктуре.

