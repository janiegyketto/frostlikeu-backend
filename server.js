const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ========== KONFIGURÁCIÓ ==========
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

// ========== DISCORD ==========
async function getDiscordStatus() {
    try {
        const response = await axios.get(`https://discord.com/api/v9/users/${CONFIG.discord.userId}/profile`, {
            headers: {
                'Authorization': `Bot ${CONFIG.discord.botToken}`
            }
        });
        
        const presence = response.data.presence || {};
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
    } catch (error) {
        console.error('Discord error:', error.message);
        return { online: false, error: true };
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
        return spotifyAccessToken;
    } catch (error) {
        console.error('Spotify token error:', error.response?.data || error.message);
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
            return {
                isPlaying: true,
                track: response.data.item.name,
                artist: response.data.item.artists.map(a => a.name).join(', '),
                progress: response.data.progress_ms,
                duration: response.data.item.duration_ms
            };
        } else {
            return { isPlaying: false };
        }
    } catch (error) {
        console.error('Spotify error:', error.message);
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
        
        return {
            online: player.personastate !== 0,
            game: gameInfo
        };
    } catch (error) {
        console.error('Steam error:', error.message);
        return { online: false };
    }
}

// ========== API VÉGPONT ==========
app.get('/api/status', async (req, res) => {
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
    console.log(`Server running on port ${PORT}`);
});