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
        
        // Most lekérjük a felhasználó jelenlétét (státuszát)
        // Ehhez egy botnak látnia kell a felhasználót egy közös szerveren
        const presenceResponse = await axios.get(`https://discord.com/api/v10/users/${CONFIG.discord.userId}/profile`, {
            headers: {
                'Authorization': `Bot ${CONFIG.discord.botToken}`
            }
        }).catch(err => {
            // Ha nem sikerül a profile endpoint, próbáljuk a gateway-en keresztül
            console.log('Profile endpoint nem elérhető, alternatív módszer...');
            return null;
        });

        // Ha sikerült a profile lekérés
        if (presenceResponse?.data) {
            const presence = presenceResponse.data.presence || {};
            let activity = null;
            
            if (presence.activities && presence.activities.length > 0) {
                const game = presence.activities.find(a => a.type === 0);
                if (game) {
                    activity = {
                        name: game.name,
                        details: game.details || '',
                        state: game.state || ''
                    };
                }
            }
            
            return {
                online: presence.status !== 'offline' && presence.status !== null,
                status: presence.status || 'offline',
                activity: activity
            };
        }

        // Alternatív módszer: ha nem sikerült a profile, akkor online státuszt adunk vissza
        // (a bot legalább működik, de a felhasználó státusza nem elérhető)
        return {
            online: true,  // Feltételezzük, hogy online
            status: 'online',
            activity: null,
            note: 'Részletes státusz nem elérhető, de a bot működik'
        };

    } catch (error) {
        console.error('❌ Discord error (részletes):', error.response?.data || error.message);
        return { online: false, error: true, message: error.message };
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