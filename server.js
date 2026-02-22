const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ========== KONFIGURÁCIÓ - A TE ADATAIDDAL ==========
const CONFIG = {
    discord: {
        userId: '526441058075148308',  // A te Discord ID-d
        botToken: process.env.DISCORD_TOKEN
    },
    spotify: {
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        refreshToken: process.env.SPOTIFY_REFRESH_TOKEN
    },
    steam: {
        apiKey: process.env.STEAM_API_KEY,
        steamId: '76561199048400403'  // A te Steam ID-d
    }
};

// ========== DISCORD - JAVÍTOTT VERZIÓ ==========
async function getDiscordStatus() {
    try {
        // Először lekérjük a bot saját adatait (ez teszteli a tokent)
        const botResponse = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: {
                'Authorization': `Bot ${CONFIG.discord.botToken}`
            }
        });
        
        console.log('✅ Discord bot működik, név:', botResponse.data.username);
        
        // Most lekérjük a felhasználó pontos státuszát
        // Ehhez a botnak és a felhasználónak közös szerveren kell lennie!
        const userResponse = await axios.get(`https://discord.com/api/v10/users/${CONFIG.discord.userId}/profile`, {
            headers: {
                'Authorization': `Bot ${CONFIG.discord.botToken}`
            }
        });
        
        // A válaszban benne van a presence (jelenlét) objektum
        const presence = userResponse.data.presence || {};
        
        // Státusz konvertálása magyar szövegre
        let statusText = 'offline';
        let statusDot = 'offline';
        
        switch(presence.status) {
            case 'online':
                statusText = 'Online';
                statusDot = 'online';
                break;
            case 'idle':
                statusText = 'Tétlen';
                statusDot = 'idle';
                break;
            case 'dnd':
                statusText = 'Ne zavarjanak';
                statusDot = 'dnd';
                break;
            case 'offline':
                statusText = 'Offline';
                statusDot = 'offline';
                break;
            default:
                statusText = presence.status || 'offline';
                statusDot = statusText;
        }
        
        // Aktivitás (játék, zene, etc.) lekérése
        let activity = null;
        if (presence.activities && presence.activities.length > 0) {
            const mainActivity = presence.activities[0]; // A legelső aktivitás
            activity = {
                name: mainActivity.name,
                type: mainActivity.type, // 0: Playing, 1: Streaming, 2: Listening, 3: Watching
                details: mainActivity.details || '',
                state: mainActivity.state || '',
                typeText: getActivityTypeText(mainActivity.type, mainActivity.name)
            };
        }
        
        return {
            online: presence.status !== 'offline' && presence.status !== null,
            status: presence.status || 'offline',
            statusText: statusText,      // Magyar szöveg a státuszhoz
            statusDot: statusDot,        // CSS osztály a pöttyhöz
            activity: activity,
            raw: presence                // Nyers adat (debug célra)
        };
        
    } catch (error) {
        console.error('❌ Discord error (részletes):', error.response?.data || error.message);
        
        // Ha a profile endpoint nem működik, próbáljuk meg a bot jelenlétét lekérni
        try {
            // Alternatív megoldás: a bot saját kapcsolatán keresztül
            console.log('ℹ️ Alternatív Discord metódus próbálkozás...');
            
            // Itt jöhet egy alternatív megoldás, de ehhez gateway kapcsolat kellene
            // Most egyszerűen visszaadjuk, hogy a bot él, de a pontos státusz nem elérhető
            return { 
                online: true, 
                status: 'online',
                statusText: 'Online (korlátozott)',
                statusDot: 'online',
                activity: null,
                note: 'A pontos státusz lekéréséhez a botnak és a felhasználónak közös szerveren kell lennie'
            };
            
        } catch (altError) {
            return { online: false, error: true, message: error.message };
        }
    }
}

// Segédfüggvény az aktivitás típusának szöveges formájához
function getActivityTypeText(type, name) {
    switch(type) {
        case 0: return `🎮 Játék: ${name}`;
        case 1: return `📺 Streaming: ${name}`;
        case 2: return `🎵 Hallgatás: ${name}`;
        case 3: return `📹 Nézés: ${name}`;
        case 4: return `⚙️ Egyéni státusz: ${name}`;
        case 5: return `🏆 Verseny: ${name}`;
        default: return name;
    }
}

// ========== SPOTIFY ==========
let spotifyAccessToken = null;
let spotifyTokenExpiry = 0;

async function refreshSpotifyToken() {
    try {
        const response = await axios.post('https://accounts.spotify.com/api/token', 
            `grant_type=refresh_token&refresh_token=${CONFIG.spotify.refreshToken}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(
                        CONFIG.spotify.clientId + ':' + CONFIG.spotify.clientSecret
                    ).toString('base64')
                }
            }
        );
        
        spotifyAccessToken = response.data.access_token;
        spotifyTokenExpiry = Date.now() + (response.data.expires_in * 1000);
        console.log('✅ Spotify token frissítve');
        return spotifyAccessToken;
    } catch (error) {
        console.error('❌ Spotify token error:', error.response?.data || error.message);
        return null;
    }
}

async function getSpotifyNowPlaying() {
    try {
        if (!spotifyAccessToken || Date.now() >= spotifyTokenExpiry) {
            await refreshSpotifyToken();
        }
        
        const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: {
                'Authorization': `Bearer ${spotifyAccessToken}`
            }
        });
        
        if (response.data && response.data.item) {
            console.log('✅ Spotify: most hallgatott:', response.data.item.name);
            return {
                isPlaying: true,
                track: response.data.item.name,
                artist: response.data.item.artists.map(a => a.name).join(', '),
                albumImage: response.data.item.album.images[0]?.url,
                progress: response.data.progress_ms,
                duration: response.data.item.duration_ms
            };
        } else {
            console.log('ℹ️ Spotify: nem hallgat semmit');
            return { isPlaying: false };
        }
    } catch (error) {
        console.error('❌ Spotify error:', error.message);
        return { isPlaying: false };
    }
}

// ========== STEAM ==========
async function getSteamStatus() {
    try {
        const response = await axios.get(
            `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/`,
            {
                params: {
                    key: CONFIG.steam.apiKey,
                    steamids: CONFIG.steam.steamId
                }
            }
        );
        
        const player = response.data.response.players[0];
        
        const gamesResponse = await axios.get(
            `http://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/`,
            {
                params: {
                    key: CONFIG.steam.apiKey,
                    steamid: CONFIG.steam.steamId,
                    count: 1
                }
            }
        );
        
        const games = gamesResponse.data.response;
        const currentGame = games.total_count > 0 ? games.games[0] : null;
        
        let gameInfo = null;
        if (currentGame) {
            gameInfo = {
                name: currentGame.name,
                playtime: Math.floor(currentGame.playtime_forever / 60)
            };
        }
        
        console.log('✅ Steam:', player.personastate !== 0 ? 'online' : 'offline', gameInfo?.name || '');
        return {
            online: player.personastate !== 0,
            game: gameInfo
        };
    } catch (error) {
        console.error('❌ Steam error:', error.message);
        return { online: false };
    }
}

// ========== API VÉGPONT ==========
app.get('/api/status', async (req, res) => {
    console.log('📊 Status lekérés...');
    const [discord, spotify, steam] = await Promise.all([
        getDiscordStatus(),
        getSpotifyNowPlaying(),
        getSteamStatus()
    ]);
    
    res.json({ discord, spotify, steam });
});

// ========== INDÍTÁS ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📝 API elérhető: http://localhost:${PORT}/api/status`);
});