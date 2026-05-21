const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

async function validateClientId(id) {
    try {
        const res = await fetch(`https://api-v2.soundcloud.com/search?q=test&client_id=${id}&limit=1`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        return res.ok;
    } catch (e) {
        return false;
    }
}

async function getSoundCloudToken() {
    try {
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
                        return match[1];
                    }
                } catch (e) { }
            }
        }
    } catch (err) {
        console.error("Error scraping token:", err.message);
    }
    return null;
}

async function findPlayableTrack(query, token) {
    const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${token}&limit=10`;
    console.log(`Searching for "${query}"...`);
    try {
        const searchRes = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://soundcloud.com/' }
        });
        const searchData = await searchRes.json();
        if (!searchData || !searchData.collection || searchData.collection.length === 0) {
            console.log("No tracks found at all.");
            return null;
        }

        for (let track of searchData.collection) {
            if (track.kind !== 'track' || !track.media || !track.media.transcodings) continue;
            
            // Filter out encrypted transcodings
            const transcodings = track.media.transcodings.filter(t => !t.format.protocol.includes('encrypted'));
            if (transcodings.length === 0) continue;

            // Prioritize progressive, then hls
            let chosenTranscoding = transcodings.find(t => t.format.protocol === 'progressive');
            if (!chosenTranscoding) {
                chosenTranscoding = transcodings.find(t => t.format.protocol === 'hls');
            }
            if (!chosenTranscoding) {
                chosenTranscoding = transcodings[0];
            }

            if (!chosenTranscoding) continue;

            try {
                const streamUrl = `${chosenTranscoding.url}?client_id=${token}`;
                const streamInfoRes = await fetch(streamUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                });
                
                if (streamInfoRes.ok) {
                    const streamInfo = await streamInfoRes.json();
                    if (streamInfo && streamInfo.url) {
                        console.log(`Found playable track: "${track.title}" by "${track.user.username}"`);
                        console.log(`Stream URL: ${streamInfo.url.substring(0, 100)}...`);
                        return {
                            track,
                            audioUrl: streamInfo.url,
                            transcoding: chosenTranscoding
                        };
                    }
                } else {
                    console.log(`Track "${track.title}" was not streamable (status ${streamInfoRes.status}). Trying next...`);
                }
            } catch (err) {
                console.log(`Error trying track "${track.title}": ${err.message}`);
            }
        }
    } catch (e) {
        console.error("Search failed:", e.message);
    }
    return null;
}

async function run() {
    let token = await getSoundCloudToken();
    if (!token) return;
    
    await findPlayableTrack("bladee", token);
    await findPlayableTrack("cowboyclicker trainspotting", token);
    await findPlayableTrack("nettspend no sleep", token);
}

run();
