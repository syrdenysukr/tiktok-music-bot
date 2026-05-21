// Принудительно заставляем Node.js использовать IPv4 вместо IPv6 (убирает сетевые ошибки fetch)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { WebcastPushConnection } = require('tiktok-live-connector');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// НАСТРОЙКИ
const TIKTOK_USERNAME = "ВАШ_НИК_В_ТИКТОК"; // Укажите ваш ник без @
const COMMAND_PLAY = "!play";
const COMMAND_SKIP = "!skip";

// Настройки цен для заказа и пропуска (0 = бесплатно)
const WIDGET_SETTINGS = {
    playPriceCoins: 0, // Стоимость заказа песни в монетах (0 = бесплатно по команде !play)
    skipPriceCoins: 0  // Стоимость пропуска песни в монетах (0 = бесплатно по команде !skip)
};

// Хранилище баланса монет/скипов зрителей (сбрасывается для каждого стрима/перезапуска)
let viewerBalances = {}; // { uniqueId: { skips: 0, coinsGifted: 0 } }

function getViewer(username) {
    if (!viewerBalances[username]) {
        viewerBalances[username] = {
            skips: 0,
            coinsGifted: 0
        };
    }
    return viewerBalances[username];
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let playlist = [];
let currentTrack = null;
let soundcloudClientId = "";

app.use(express.static(path.join(__dirname)));

// 1. Проверка ключа на валидность (стучимся тестовым микро-запросом)
async function validateClientId(id) {
    try {
        const res = await fetch(`https://api-v2.soundcloud.com/search?q=test&client_id=${id}&limit=1`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        return res.ok; // Если сервер ответил 200, то ключ рабочий!
    } catch (e) {
        return false;
    }
}

// 2. Улучшенный сканер главной страницы SoundCloud
async function getSoundCloudToken() {
    try {
        console.log("[SoundCloud] Сканирование медиа-серверов...");
        const res = await fetch('https://soundcloud.com', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const html = await res.text();
        const scriptMatches = [...html.matchAll(/src="([^"]+)"/g)].map(m => m[1]);

        for (let url of scriptMatches) {
            let fullUrl = url;
            if (url.startsWith('//')) fullUrl = `https:${url}`;
            else if (url.startsWith('/')) fullUrl = `https://soundcloud.com${url}`;

            if (fullUrl.includes('sndcdn.com') || fullUrl.includes('assets')) {
                try {
                    const scriptRes = await fetch(fullUrl);
                    const scriptText = await scriptRes.text();
                    const match = scriptText.match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/i) || scriptText.match(/client_id\s*=\s*"([a-zA-Z0-9]{32})"/i);

                    if (match && await validateClientId(match[1])) {
                        soundcloudClientId = match[1];
                        console.log(`[SoundCloud] Токен успешно спарсен: ${soundcloudClientId}`);
                        return true;
                    }
                } catch (e) { }
            }
        }
    } catch (err) {
        console.error("[SoundCloud] Ошибка автопарсинга:", err.message);
    }
    return false;
}

// Веб-сокет связь
wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ 
        type: 'UPDATE_PLAYLIST', 
        playlist, 
        currentTrack, 
        settings: WIDGET_SETTINGS, 
        viewerBalances 
    }));

    // Обработка тестовых сообщений от клиента
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'TEST_CHAT') {
                const msg = data.message.trim();
                console.log(`[Тест] Ввод в эмулятор чата: "${msg}"`);
                
                // Проверяем эмуляцию подарка: !gift [число монет]
                const giftMatch = msg.match(/^!gift\s+(\d+)$/i);
                if (giftMatch) {
                    const coins = parseInt(giftMatch[1], 10);
                    console.log(`[Тест] Эмуляция подарка от Тест_Панель на ${coins} монет`);
                    
                    if (tiktokConnection) {
                        tiktokConnection.emit('gift', {
                            uniqueId: "Тест_Панель",
                            giftId: 9999,
                            giftName: "Тестовая Роза",
                            repeatCount: 1,
                            diamondCount: coins,
                            giftType: 1,
                            repeatEnd: true
                        });
                    }
                    return;
                }

                // Эмулируем событие чата Tik Tok с сырым текстом
                if (tiktokConnection) {
                    tiktokConnection.emit('chat', {
                        comment: msg,
                        uniqueId: "Тест_Панель"
                    });
                }
            }
        } catch (e) {
            console.error("Ошибка разбора WebSocket сообщения от клиента:", e.message);
        }
    });
});

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function sendPlaylistUpdate() {
    broadcast({
        type: 'UPDATE_PLAYLIST',
        playlist,
        currentTrack,
        settings: WIDGET_SETTINGS,
        viewerBalances
    });
}

// Чат TikTok
let tiktokConnection = new WebcastPushConnection(TIKTOK_USERNAME);
tiktokConnection.connect().then(state => {
    console.log(`Успешно подключились к чату аккаунта: ${TIKTOK_USERNAME}`);
}).catch(err => {
    console.error('Ошибка чата TikTok (Игнорируйте при тесте без стрима)');
});

// 3. Поиск воспроизводимого трека
async function findPlayableTrack(query, token) {
    const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${token}&limit=10`;
    try {
        const searchRes = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://soundcloud.com/' }
        });
        const searchData = await searchRes.json();
        if (!searchData || !searchData.collection || searchData.collection.length === 0) {
            return null;
        }

        for (let track of searchData.collection) {
            if (track.kind !== 'track' || !track.media || !track.media.transcodings) continue;
            
            // Исключаем зашифрованные HLS транскодирования
            const transcodings = track.media.transcodings.filter(t => !t.format.protocol.includes('encrypted'));
            if (transcodings.length === 0) continue;

            // Используем только progressive (MP3) транскодирование, так как HLS блокируется браузерами из-за CORS
            let chosenTranscoding = transcodings.find(t => t.format.protocol === 'progressive');
            if (!chosenTranscoding) continue;

            // Проверяем доступность медиа-ссылки (чтобы не было 404)
            try {
                const streamUrl = `${chosenTranscoding.url}?client_id=${token}`;
                const streamInfoRes = await fetch(streamUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                });
                
                if (streamInfoRes.ok) {
                    const streamInfo = await streamInfoRes.json();
                    if (streamInfo && streamInfo.url) {
                        return {
                            track,
                            transcodingUrl: chosenTranscoding.url
                        };
                    }
                }
            } catch (err) {
                console.error(`Ошибка при проверке трека "${track.title}":`, err.message);
            }
        }
    } catch (e) {
        console.error("Ошибка поиска в SoundCloud:", e.message);
    }
    return null;
}

// 4. Динамическое получение свежей аудио-ссылки перед воспроизведением
async function resolveStreamUrl(track) {
    if (!track || !track.transcodingUrl) return null;
    try {
        const streamInfoRes = await fetch(`${track.transcodingUrl}?client_id=${soundcloudClientId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (streamInfoRes.ok) {
            const streamInfo = await streamInfoRes.json();
            return streamInfo.url;
        }
    } catch (e) {
        console.error(`Ошибка резолвинга ссылки для "${track.title}":`, e.message);
    }
    return null;
}

// 5. Установка текущего трека с подгрузкой свежей ссылки
async function setCurrentTrack(track) {
    if (!track) {
        currentTrack = null;
        sendPlaylistUpdate();
        return;
    }

    console.log(`[Плеер] Загрузка стрима: ${track.artist} - ${track.title}`);
    const freshAudioUrl = await resolveStreamUrl(track);
    if (freshAudioUrl) {
        currentTrack = {
            ...track,
            audioUrl: freshAudioUrl
        };
        console.log(`[Плеер] Трек готов к воспроизведению.`);
    } else {
        console.log(`[Плеер] Не удалось получить стрим для "${track.artist} - ${track.title}". Пропуск.`);
        if (playlist.length > 0) {
            await setCurrentTrack(playlist.shift());
        } else {
            currentTrack = null;
        }
    }
    sendPlaylistUpdate();
}

// Логика обработки заказов песен
tiktokConnection.on('chat', async (data) => {
    const message = data.comment.trim();
    const username = data.uniqueId;

    const playMatch = message.match(/^!play\s+(.+)$/i);
    const skipMatch = message.match(/^!skip\s*$/i);

    if (playMatch) {
        const query = playMatch[1].trim();
        if (!query) return;

        // Проверка баланса перед заказом трека, если заказ платный
        if (WIDGET_SETTINGS.playPriceCoins > 0) {
            const viewer = getViewer(username);
            if (viewer.skips < WIDGET_SETTINGS.playPriceCoins) {
                console.log(`[Чат] У ${username} недостаточно скипов/монет для заказа песни. Требуется: ${WIDGET_SETTINGS.playPriceCoins}, баланс: ${viewer.skips}`);
                return;
            }
        }

        console.log(`[Чат] ${username} заказал песню: "${query}"`);

        // Ограничение очереди в 10 треков
        if (playlist.length >= 10) {
            console.log(`[Плейлист] Очередь заполнена (10 треков). Заказ от ${username} отклонен.`);
            return;
        }

        try {
            const result = await findPlayableTrack(query, soundcloudClientId);

            if (result) {
                const track = result.track;
                let artworkUrl = track.artwork_url || (track.user && track.user.avatar_url) || '';
                if (artworkUrl) {
                    artworkUrl = artworkUrl.replace('-large.', '-t500x500.');
                }

                // Списываем стоимость заказа ТОЛЬКО если трек успешно найден и добавлен
                if (WIDGET_SETTINGS.playPriceCoins > 0) {
                    const viewer = getViewer(username);
                    viewer.skips -= WIDGET_SETTINGS.playPriceCoins;
                    console.log(`[Баланс] Списано ${WIDGET_SETTINGS.playPriceCoins} скипов у ${username}. Остаток: ${viewer.skips}`);
                }

                const newTrack = {
                    id: track.id,
                    title: track.title,
                    artist: track.user.username,
                    requestedBy: username,
                    artworkUrl: artworkUrl,
                    transcodingUrl: result.transcodingUrl
                };

                playlist.push(newTrack);
                console.log(`[Плейлист] Добавлен трек: ${newTrack.artist} - ${newTrack.title}`);

                if (currentTrack === null) {
                    await setCurrentTrack(playlist.shift());
                } else {
                    sendPlaylistUpdate();
                }
            } else {
                console.log(`[SoundCloud] Ничего не найдено или нет доступных потоков для запроса: ${query}`);
            }
        } catch (error) {
            console.error('Ошибка обработки трека:', error.message);
        }
    } else if (skipMatch) {
        // Проверка баланса перед пропуском трека, если пропуск платный
        if (WIDGET_SETTINGS.skipPriceCoins > 0) {
            const viewer = getViewer(username);
            if (viewer.skips < WIDGET_SETTINGS.skipPriceCoins) {
                console.log(`[Чат] У ${username} недостаточно скипов/монет для пропуска трека. Требуется: ${WIDGET_SETTINGS.skipPriceCoins}, баланс: ${viewer.skips}`);
                return;
            }
            viewer.skips -= WIDGET_SETTINGS.skipPriceCoins;
            console.log(`[Баланс] Списано ${WIDGET_SETTINGS.skipPriceCoins} скипов у ${username} за пропуск. Остаток: ${viewer.skips}`);
            sendPlaylistUpdate();
        }

        console.log(`[Чат] ${username} запросил пропуск трека (!skip).`);
        broadcast({ type: 'SKIP_TRACK' });
    } else {
        console.log(`[Чат] Сообщение от ${username} проигнорировано (нет команды !play или !skip): "${message}"`);
    }
});

// Обработка подарков от зрителей
tiktokConnection.on('gift', (data) => {
    try {
        const username = data.uniqueId;
        const giftId = data.giftId;
        const giftName = data.giftName || `Gift #${giftId}`;
        const count = data.repeatCount || 1;
        const coinsPerGift = data.diamondCount || 0;

        // Для серийных подарков обрабатываем только финальное событие серии (repeatEnd === true)
        if (data.giftType === 1 && !data.repeatEnd) {
            return;
        }

        const totalCoins = coinsPerGift * count;
        if (totalCoins <= 0) return;

        console.log(`[Подарок] ${username} подарил ${giftName} x${count} (${totalCoins} монет)`);

        // За каждую подаренную монету начисляем зрителю 1 скип-поинт
        const viewer = getViewer(username);
        viewer.coinsGifted += totalCoins;
        viewer.skips += totalCoins;

        console.log(`[Баланс] ${username}: всего подарено ${viewer.coinsGifted} монет, доступно скипов: ${viewer.skips}`);
        
        sendPlaylistUpdate();
    } catch (e) {
        console.error("Ошибка при обработке подарка:", e.message);
    }
});

app.get('/next', async (req, res) => {
    if (playlist.length > 0) {
        await setCurrentTrack(playlist.shift());
    } else {
        await setCurrentTrack(null);
    }
    res.sendStatus(200);
});

// Очередь эмуляции
function startTestQueue() {
    console.log("[ТЕСТ] Инициализация тестовой очереди песен...");
    if (tiktokConnection) {
        tiktokConnection.emit('chat', { comment: "!play cowboyclicker trainspotting", uniqueId: "Denys_706" });
        setTimeout(() => {
            tiktokConnection.emit('chat', { comment: "!play nettspend no sleep", uniqueId: "xav_fan" });
        }, 2000);
        setTimeout(() => {
            tiktokConnection.emit('chat', { comment: "!play bladee", uniqueId: "drainer99" });
        }, 4000);
        setTimeout(() => {
            console.log("[ТЕСТ] Имитация команды !skip...");
            tiktokConnection.emit('chat', { comment: "!skip", uniqueId: "Denys_706" });
        }, 10000);
    }
}

// Старт сервера
server.listen(3000, async () => {
    console.log('Бот запущен! Откройте http://localhost:3000 в браузере или ТТ Студии');

    // Шаг 1: Пробуем найти динамически
    let hasToken = await getSoundCloudToken();

    // Шаг 2: Если автопоиск не сработал, перебираем базу свежих публичных ключей
    if (!hasToken) {
        console.log("[SoundCloud] Автопоиск заблокирован. Включаю подбор резервных токенов...");
        const fallbacks = [
            "b45b1aa10f1ac2941910a7f0d10f8e28", // Популярный публичный ID
            "2t9ms3w8vUr6X10m7b6ALg066g1vX69A", // Ключ официальных виджетов
            "02gUJC0hH2ct1EGOcYXQIzRFU914byas",
            "iZ1v7vC76qnCg6v6b88b77v7"
        ];

        for (let id of fallbacks) {
            console.log(`[SoundCloud] Тестирую резервный ключ: ${id}...`);
            const isValid = await validateClientId(id);
            if (isValid) {
                soundcloudClientId = id;
                hasToken = true;
                console.log(`[SoundCloud] Успешно! Найден рабочий резервный токен: ${soundcloudClientId}\n`);
                break;
            }
        }
    }

    if (hasToken) {
        setTimeout(startTestQueue, 2000);
    } else {
        console.log("\n[Критично] Не удалось подобрать рабочий токен. SoundCloud временно ограничил запросы вашего IP. Попробуйте позже.");
    }
});