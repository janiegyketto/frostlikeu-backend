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
        userId: '526441058075148308'
    },
    spotify: {
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        refreshToken: process.env.SPOTIFY_REFRESH_TOKEN
    },
    steam: {
        apiKey: process.env.STEAM_API_KEY,
        steamId: '76561199048400403'
    }
};

// ========== DISCORD - LANYARD API ==========
async function getDiscordStatus() {
    try {
        const response = await axios.get(`https://api.lanyard.rest/v1/users/${CONFIG.discord.userId}`);
        
        if (response.data.success) {
            const data = response.data.data;
            
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
            }
            
            let activity = null;
            if (data.activities && data.activities.length > 0) {
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
            
            return {
                online: isOnline,
                status: data.discord_status,
                statusText: statusText,
                statusDot: statusDot,
                activity: activity
            };
        }
        
        return { online: false, status: 'offline', statusText: 'Offline', statusDot: 'offline' };
        
    } catch (error) {
        console.error('❌ Lanyard error:', error.response?.data || error.message);
        return { online: false, status: 'offline', statusText: 'Offline', statusDot: 'offline', error: true };
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
            console.log('✅ Spotify:', response.data.item.name);
            return {
                isPlaying: true,
                track: response.data.item.name,
                artist: response.data.item.artists.map(a => a.name).join(', '),
                albumImage: response.data.item.album.images[0]?.url,
                trackUrl: response.data.item.external_urls.spotify,
                progress: response.data.progress_ms,
                duration: response.data.item.duration_ms
            };
        } else {
            console.log('ℹ️ Spotify: nincs zene');
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
        
        let status = 'offline';
        let statusText = 'Offline';
        
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
        }
        
        let gameInfo = null;
        if (player.gameid) {
            gameInfo = {
                id: player.gameid,
                name: player.gameextrainfo || 'Játékban'
            };
        }
        
        console.log('✅ Steam:', statusText, gameInfo?.name || '');
        
        return {
            online: player.personastate !== 0,
            status: status,
            statusText: statusText,
            game: gameInfo
        };
        
    } catch (error) {
        console.error('❌ Steam error:', error.message);
        return { online: false, status: 'offline', statusText: 'Offline', game: null };
    }
}

// ========== STATS FÜGGVÉNYEK ==========

async function getSteamMonthlyStats() {
    try {
        const gamesResponse = await axios.get(
            `http://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/`,
            {
                params: {
                    key: CONFIG.steam.apiKey,
                    steamid: CONFIG.steam.steamId,
                    count: 10
                }
            }
        );
        
        const games = gamesResponse.data.response;
        if (games.total_count > 0) {
            const totalPlaytime = games.games.reduce((sum, game) => 
                sum + (game.playtime_2weeks || 0), 0) / 60;
            
            const topGame = games.games.sort((a, b) => 
                (b.playtime_2weeks || 0) - (a.playtime_2weeks || 0)
            )[0];
            
            return {
                totalHours: Math.round(totalPlaytime * 10) / 10,
                topGame: topGame ? {
                    name: topGame.name,
                    hours: Math.round(((topGame.playtime_2weeks || 0) / 60) * 10) / 10
                } : null,
                gamesCount: games.total_count
            };
        }
        return null;
    } catch (error) {
        console.error('Steam stats error:', error.message);
        return null;
    }
}

async function getSpotifyMonthlyStats() {
    try {
        if (!spotifyAccessToken || Date.now() >= spotifyTokenExpiry) {
            await refreshSpotifyToken();
        }
        
        const response = await axios.get('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
            headers: {
                'Authorization': `Bearer ${spotifyAccessToken}`
            }
        });
        
        const tracks = response.data.items;
        if (tracks.length > 0) {
            const artistCount = {};
            tracks.forEach(item => {
                item.track.artists.forEach(artist => {
                    artistCount[artist.name] = (artistCount[artist.name] || 0) + 1;
                });
            });
            
            const topArtist = Object.entries(artistCount)
                .sort((a, b) => b[1] - a[1])[0];
            
            return {
                totalTracks: tracks.length,
                topArtist: topArtist ? {
                    name: topArtist[0],
                    count: topArtist[1]
                } : null,
                uniqueArtists: Object.keys(artistCount).length
            };
        }
        return null;
    } catch (error) {
        console.error('Spotify stats error:', error.message);
        return null;
    }
}

// ========== API VÉGPONT ==========
app.get('/api/status', async (req, res) => {
    console.log('📊 Status lekérés...');
    const [discord, spotify, steam, steamStats, spotifyStats] = await Promise.all([
        getDiscordStatus(),
        getSpotifyNowPlaying(),
        getSteamStatus(),
        getSteamMonthlyStats(),
        getSpotifyMonthlyStats()
    ]);
    
    res.json({ 
        discord, 
        spotify, 
        steam,
        stats: {
            steam: steamStats,
            spotify: spotifyStats
        }
    });
});

// ========== INDÍTÁS ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});