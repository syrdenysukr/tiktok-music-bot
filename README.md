# TikTok Live Music Bot / Музыкальный Бот для ТикТок Стримов

[English](#english) | [Русский](#русский)

---

## English

A Node.js and WebSocket-based interactive widget designed to display and play background music requested by viewers during TikTok Live streams. Integrating SoundCloud search, TikTok Live Webcast push connections, queue limits, and stream modes.

### Features
1. **Interactive Music Requests**: Viewers order songs using the `!play [track name]` command in the TikTok chat.
2. **Strict Command Validation**: Utilizes robust regex matching to ensure only messages starting with `!play ` trigger song searches, ignoring raw messages like "stay" to avoid cluttering.
3. **Queue Limit**: Supports a maximum of 10 tracks in the queue, rendering up to 6 visually on the widget, showing the total track count (e.g., `3/10`).
4. **Skip Command**: Streamers or authorized users can skip songs using the `!skip` command.
5. **Autoplay Bypass & Modes**:
   - **Stream Mode**: Hides the test panel entirely, making it ready to overlay in OBS or TikTok Live Studio.
   - **Test Mode**: Displays a mock chat panel on the screen to emulate comments and gifts during local testing.
6. **Viewer Gift & Balance Integration**:
   - Configurable action pricing (order/skip costs in coins/skips) in `server.js`.
   - Automatically tracks viewer point balances. Every coin gifted credits the user with 1 skip-point (`1 coin = 1 skip`).
   - Deducts coins/points only when songs are successfully played or skipped.
   - Resets state for each live session to keep things clean.

### Installation & Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/syrdenysukr/tiktok-music-bot.git
   cd tiktok-music-bot
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure settings in `server.js`:
   - Set your username: `const TIKTOK_USERNAME = "your_username";`
   - Adjust gift action prices:
     ```javascript
     const WIDGET_SETTINGS = {
         playPriceCoins: 0, // Order price (0 = free)
         skipPriceCoins: 0  // Skip price (0 = free)
     };
     ```
4. Start the server:
   ```bash
   npm start
   ```
5. Open `http://localhost:3000` in your browser (or add as browser source in OBS / TikTok Studio).
6. Click **Stream Mode** or **Test Mode** to unlock audio playback.

### Emulating Gifts locally (Test Mode)
In **Test Mode**, type `!gift [coins]` (e.g., `!gift 10`) in the emulator input to credit yourself mock skips and test gift-based song order/skips.

---

## Русский

Интерактивный виджет на базе Node.js и WebSocket, разработанный для трансляции и воспроизведения фоновой музыки по заказам зрителей во время стримов в TikTok Live. Виджет интегрирует поиск через SoundCloud, автоматический коннектор к чату TikTok Live, лимиты очереди и режим тестирования.

### Возможности
1. **Интерактивный заказ музыки**: Зрители могут заказывать треки с помощью команды `!play [название]` прямо в чате стрима.
2. **Строгая валидация команд**: Поиск запускается только при отправке сообщений, начинающихся строго с `!play ` (повышенная устойчивость к спаму и обычному тексту в чате).
3. **Лимит и визуализация очереди**: Максимальный лимит очереди — 10 треков, при этом визуально отображается до 6 элементов очереди с общим счетчиком (например, `3/10`).
4. **Команда пропуска**: Пропустить текущую песню можно через команду `!skip`.
5. **Выбор режима при запуске**:
   - **Режим Стрима**: Панель тестирования полностью скрывается, чтобы виджет можно было чисто захватить в OBS / TikTok Live Studio.
   - **Режим Теста**: Открывает удобную боковую панель для эмуляции сообщений чата и отправки подарков.
6. **Интеграция с подарками и балансом зрителей**:
   - Настраиваемые цены за заказ или пропуск трека в `server.js` (по умолчанию бесплатно).
   - Автоматический учет монет: каждая подаренная монета конвертируется в 1 очко пропуска/заказа (`1 монета = 1 скип`).
   - Списание баланса происходит только при успешном нахождении трека или подтвержденном пропуске.
   - Вся статистика сбрасывается для каждого стрима (хранится в оперативной памяти).

### Установка и Запуск
1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/syrdenysukr/tiktok-music-bot.git
   cd tiktok-music-bot
   ```
2. Установите зависимости:
   ```bash
   npm install
   ```
3. Настройте параметры в `server.js`:
   - Укажите ваш никнейм: `const TIKTOK_USERNAME = "ваш_ник";`
   - Настройте стоимость действий:
     ```javascript
     const WIDGET_SETTINGS = {
         playPriceCoins: 0, // Цена за !play (0 = бесплатно)
         skipPriceCoins: 0  // Цена за !skip (0 = бесплатно)
     };
     ```
4. Запустите сервер:
   ```bash
   npm start
   ```
5. Откройте `http://localhost:3000` в браузере (или добавьте как источник браузера в OBS / TikTok Studio).
6. Выберите нужный режим для активации звука.

### Тестирование подарков локально (Режим теста)
В режиме тестирования введите в эмулятор чата команду `!gift [число]` (например, `!gift 15`), чтобы зачислить себе тестовый баланс и проверить платное воспроизведение/пропуски.
