# @striderlabs/mcp-spotify

MCP server for Spotify — let AI agents search music, control playback, and manage playlists via the Spotify Web API.

Built by [Strider Labs](https://striderlabs.ai).

## Features

- **Search** — Find tracks, artists, albums, and playlists
- **Playlists** — View, create, and edit your playlists
- **Playback Control** — Play, pause, skip, go back, set volume
- **Multi-device** — List and switch between Spotify Connect devices
- **OAuth 2.0** — Secure authorization with PKCE (no client secret needed)
- **Token persistence** — Tokens stored locally, auto-refreshed

## Setup

### 1. Create a Spotify App

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click **Create App**
3. Set **Redirect URI** to: `http://localhost:8888/callback`
4. Copy your **Client ID**

### 2. Install

```bash
npx @striderlabs/mcp-spotify
```

Or install globally:

```bash
npm install -g @striderlabs/mcp-spotify
```

### 3. Configure Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "npx",
      "args": ["-y", "@striderlabs/mcp-spotify"],
      "env": {
        "SPOTIFY_CLIENT_ID": "your_client_id_here"
      }
    }
  }
}
```

### 4. Authenticate

In Claude, call the auth tool once:

```
spotify_auth
```

A browser window will open for you to authorize access. After approving, tokens are saved locally at `~/.striderlabs/spotify/tokens.json` and auto-refreshed.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | Yes | Your Spotify app's Client ID |

## Tools

### Authentication

| Tool | Description |
|---|---|
| `spotify_status` | Check connection status and logged-in account |
| `spotify_auth` | Authorize via browser (OAuth 2.0 PKCE) |
| `spotify_logout` | Clear stored tokens |

### Search

| Tool | Parameters | Description |
|---|---|---|
| `search_tracks` | `query`, `limit?` | Search for songs |
| `search_artists` | `query`, `limit?` | Search for artists |
| `search_albums` | `query`, `limit?` | Search for albums |
| `search_playlists` | `query`, `limit?` | Search for playlists |

### Playlists

| Tool | Parameters | Description |
|---|---|---|
| `get_playlists` | `limit?` | Get your playlists |
| `create_playlist` | `name`, `description?`, `public?` | Create a new playlist |
| `add_to_playlist` | `playlistId`, `uris[]`, `position?` | Add tracks |
| `remove_from_playlist` | `playlistId`, `uris[]` | Remove tracks |

### Playback

| Tool | Parameters | Description |
|---|---|---|
| `get_currently_playing` | — | Current track, progress, device |
| `play` | `deviceId?`, `contextUri?`, `uris?[]`, `offsetPosition?`, `positionMs?` | Start/resume playback |
| `pause` | `deviceId?` | Pause playback |
| `next_track` | `deviceId?` | Skip to next track |
| `previous_track` | `deviceId?` | Go to previous track |
| `set_volume` | `volumePercent`, `deviceId?` | Set volume (0–100) |
| `get_devices` | — | List Spotify Connect devices |
| `transfer_playback` | `deviceId`, `play?` | Switch playback device |

## Example Workflow

```
1. spotify_status            → check if authenticated
2. spotify_auth              → open browser to authorize (first time)
3. search_tracks query="Bohemian Rhapsody"
4. get_devices               → list available devices
5. play uris=["spotify:track:..."] deviceId="..."
6. get_currently_playing     → see what's playing
7. set_volume volumePercent=70
8. next_track                → skip to next
9. get_playlists             → see your playlists
10. create_playlist name="AI Picks"
11. add_to_playlist playlistId="..." uris=["spotify:track:..."]
```

## Requirements

- Node.js 18+
- Spotify account (Free or Premium)
- Spotify Premium required for: volume control, playback control

## Technical Details

- **Protocol**: Model Context Protocol (MCP) over stdio
- **Auth**: OAuth 2.0 Authorization Code with PKCE
- **API**: Spotify Web API v1
- **Token storage**: `~/.striderlabs/spotify/tokens.json`
- **Browser automation**: Playwright (for OAuth browser launch)

## License

MIT — Strider Labs
