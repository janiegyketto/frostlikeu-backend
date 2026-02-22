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
// ========== DISCORD - LANYARD API ==========
async function getDiscordStatus() {
    try {
        // Lanyard API hívás - nincs szükség bot tokenre!
        const response = await axios.get(`https://api.lanyard.rest/v1/users/${CONFIG.discord.userId}`);
        
        if (response.data.success) {
            const data = response.data.data;
            
            // Státusz konvertálása
            let statusText = 'Offline';
            let statusDot = 'offline';
            let isOnline = false;
            
            switch(data.discord_status) {
                case 'online':
                    statusText = 'Online';
                    statusDot = 'online';
                    isOnline = true;
                    break;
                case 'idle':
                    statusText = 'Tétlen';
                    statusDot = 'idle';
                    isOnline = true;
                    break;
                case 'dnd':
                    statusText = 'Ne zavarjanak';
                    statusDot = 'dnd';
                    isOnline = true;
                    break;
                case 'offline':
                    statusText = 'Offline';
                    statusDot = 'offline';
                    isOnline = false;
                    break;
                default:
                    statusText = data.discord_status || 'Offline';
                    statusDot = 'offline';
                    isOnline = false;
            }
            
            // Aktivitás feldolgozása (játék, spotify stb.)
            let activity = null;
            if (data.activities && data.activities.length > 0) {
                // Keressük meg a nem custom státuszú aktivitást
                const gameActivity = data.activities.find(a => a.type !== 4);
                if (gameActivity) {
                    activity = {
                        name: gameActivity.name,
                        type: gameActivity.type,
                        details: gameActivity.details || '',
                        state: gameActivity.state || ''
                    };
                }
            }
            
            // Spotify adatok (ha van)
            let spotifyActivity = null;
            if (data.listening_to_spotify && data.spotify) {
                spotifyActivity = {
                    track: data.spotify.song,
                    artist: data.spotify.artist,
                    album: data.spotify.album,
                    trackId: data.spotify.track_id
                };
            }
            
            return {
                online: isOnline,
                status: data.discord_status,
                statusText: statusText,
                statusDot: statusDot,
                activity: activity,
                spotify: spotifyActivity,
                avatar: `https://cdn.discordapp.com/avatars/${CONFIG.discord.userId}/${data.discord_user.avatar}.png`
            };
        }
        
        return { 
            online: false, 
            status: 'offline', 
            statusText: 'Offline', 
            statusDot: 'offline' 
        };
        
    } catch (error) {
        console.error('❌ Lanyard error:', error.response?.data || error.message);
        return { 
            online: false, 
            status: 'offline',
            statusText: 'Offline',
            statusDot: 'offline',
            error: true 
        };
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
        // Lekérjük a játékos adatait (itt van a jelenlegi játék!)
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
        
        // Státusz konvertálása
        let status = 'offline';
        let statusText = 'Offline';
        
        // personastate: 0 - offline, 1 - online, 2 - elfoglalt, 3 - távollévő, 4 - alvó, 5 - szeretne játszani, 6 - szeretne játszani
        switch(player.personastate) {
            case 1:
                status = 'online';
                statusText = 'Online';
                break;
            case 2:
                status = 'busy';
                statusText = 'Elfoglalt';
                break;
            case 3:
                status = 'away';
                statusText = 'Távol';
                break;
            case 4:
                status = 'snooze';
                statusText = 'Alvó';
                break;
            case 5:
            case 6:
                status = 'looking';
                statusText = 'Szeretne játszani';
                break;
            default:
                status = 'offline';
                statusText = 'Offline';
        }
        
        // Jelenlegi játék lekérése - ez a FONTOS!
        let gameInfo = null;
        if (player.gameid) {
            // Ha van gameid, akkor játékban van
            gameInfo = {
                id: player.gameid,
                name: player.gameextrainfo || 'Ismeretlen játék',
                server: player.gameserver || null
            };
            
            // Ha a gameextrainfo üres, próbáljuk lekérni a nevet a gameid alapján
            if (!player.gameextrainfo && player.gameid) {
                try {
                    // Alternatív játéknév lekérés (ha szükséges)
                    const appResponse = await axios.get(
                        `http://api.steampowered.com/ISteamApps/GetAppList/v2/`
                    );
                    const game = appResponse.data.applist.apps.find(app => app.appid == player.gameid);
                    if (game) {
                        gameInfo.name = game.name;
                    }
                } catch (e) {
                    // Ha nem sikerül, marad az "Ismeretlen játék"
                }
            }
        }
        
        console.log('✅ Steam:', statusText, gameInfo?.name || '');
        
        return {
            online: player.personastate !== 0,
            status: status,
            statusText: statusText,
            game: gameInfo,
            lastLogoff: player.lastlogoff ? new Date(player.lastlogoff * 1000) : null
        };
        
    } catch (error) {
        console.error('❌ Steam error:', error.response?.data || error.message);
        return { 
            online: false, 
            status: 'offline', 
            statusText: 'Offline', 
            game: null 
        };
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
});