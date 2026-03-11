#!/usr/bin/env node

/**
 * Strider Labs Spotify MCP Server
 *
 * MCP server that gives AI agents the ability to search music, control
 * playback, and manage playlists via the Spotify Web API.
 * https://striderlabs.ai
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SpotifyClient } from "./spotify.js";

const server = new Server(
  { name: "strider-spotify", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// Singleton client
let client: SpotifyClient | null = null;

function getClient(): SpotifyClient {
  if (!client) {
    client = new SpotifyClient();
  }
  return client;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── Auth ────────────────────────────────────────────────────────────────
    {
      name: "spotify_status",
      description:
        "Check Spotify authentication status. Shows whether you are logged in and which account is connected. Call this first before using other tools.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "spotify_auth",
      description:
        "Authenticate with Spotify using OAuth 2.0 with PKCE. Opens a browser window for you to authorize access. Requires SPOTIFY_CLIENT_ID environment variable. Only needed once — tokens are stored locally.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "spotify_logout",
      description:
        "Log out of Spotify by clearing stored OAuth tokens. Use this to reset authentication or switch accounts.",
      inputSchema: { type: "object", properties: {} },
    },

    // ── Search ───────────────────────────────────────────────────────────────
    {
      name: "search_tracks",
      description:
        "Search for songs on Spotify. Returns track name, artists, album, duration, URI, and popularity.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g., 'Bohemian Rhapsody', 'artist:Queen', 'year:2020')",
          },
          limit: {
            type: "number",
            description: "Number of results to return (1-50, default: 20)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "search_artists",
      description:
        "Search for artists on Spotify. Returns artist name, genres, popularity, followers, and URI.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Artist name or search query",
          },
          limit: {
            type: "number",
            description: "Number of results to return (1-50, default: 20)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "search_albums",
      description:
        "Search for albums on Spotify. Returns album name, artists, release date, track count, and URI.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Album name or search query (e.g., 'Dark Side of the Moon')",
          },
          limit: {
            type: "number",
            description: "Number of results to return (1-50, default: 20)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "search_playlists",
      description:
        "Search for playlists on Spotify. Returns playlist name, owner, track count, and URI.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Playlist name or search query (e.g., 'workout hits', 'jazz classics')",
          },
          limit: {
            type: "number",
            description: "Number of results to return (1-50, default: 20)",
          },
        },
        required: ["query"],
      },
    },

    // ── Playlists ────────────────────────────────────────────────────────────
    {
      name: "get_playlists",
      description:
        "Get all playlists in your Spotify library (owned and followed). Returns playlist names, IDs, and URIs.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of playlists to return (1-50, default: 50)",
          },
        },
      },
    },
    {
      name: "create_playlist",
      description:
        "Create a new playlist in your Spotify account. Returns the new playlist ID and URI.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name for the new playlist",
          },
          description: {
            type: "string",
            description: "Optional description for the playlist",
          },
          public: {
            type: "boolean",
            description: "Whether the playlist should be public (default: false)",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "add_to_playlist",
      description:
        "Add one or more tracks to a playlist. Use track URIs from search results (e.g., 'spotify:track:...').",
      inputSchema: {
        type: "object",
        properties: {
          playlistId: {
            type: "string",
            description: "Playlist ID from get_playlists or create_playlist",
          },
          uris: {
            type: "array",
            items: { type: "string" },
            description: "List of Spotify track URIs to add (e.g., ['spotify:track:4iV5W9uYEdYUVa79Axb7Rh'])",
          },
          position: {
            type: "number",
            description: "Position to insert tracks (0-based). Omit to append at end.",
          },
        },
        required: ["playlistId", "uris"],
      },
    },
    {
      name: "remove_from_playlist",
      description:
        "Remove one or more tracks from a playlist by their Spotify track URIs.",
      inputSchema: {
        type: "object",
        properties: {
          playlistId: {
            type: "string",
            description: "Playlist ID from get_playlists",
          },
          uris: {
            type: "array",
            items: { type: "string" },
            description: "List of Spotify track URIs to remove",
          },
        },
        required: ["playlistId", "uris"],
      },
    },

    // ── Playback ─────────────────────────────────────────────────────────────
    {
      name: "get_currently_playing",
      description:
        "Get the currently playing track including name, artists, progress, device, shuffle state, and repeat state.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "play",
      description:
        "Start or resume playback. Can play a specific track, album, artist, or playlist URI. If no URI provided, resumes current playback.",
      inputSchema: {
        type: "object",
        properties: {
          deviceId: {
            type: "string",
            description: "Device ID to start playback on (from get_devices). Uses active device if omitted.",
          },
          contextUri: {
            type: "string",
            description: "Spotify URI of album, artist, or playlist to play (e.g., 'spotify:album:...')",
          },
          uris: {
            type: "array",
            items: { type: "string" },
            description: "List of track URIs to play (alternative to contextUri)",
          },
          offsetPosition: {
            type: "number",
            description: "Track index to start from within context (0-based)",
          },
          positionMs: {
            type: "number",
            description: "Position within track to start from (milliseconds)",
          },
        },
      },
    },
    {
      name: "pause",
      description: "Pause playback on the active device or a specified device.",
      inputSchema: {
        type: "object",
        properties: {
          deviceId: {
            type: "string",
            description: "Device ID to pause (from get_devices). Uses active device if omitted.",
          },
        },
      },
    },
    {
      name: "next_track",
      description: "Skip to the next track in the queue.",
      inputSchema: {
        type: "object",
        properties: {
          deviceId: {
            type: "string",
            description: "Device ID (from get_devices). Uses active device if omitted.",
          },
        },
      },
    },
    {
      name: "previous_track",
      description: "Go back to the previous track. If more than 3 seconds in, restarts current track first.",
      inputSchema: {
        type: "object",
        properties: {
          deviceId: {
            type: "string",
            description: "Device ID (from get_devices). Uses active device if omitted.",
          },
        },
      },
    },
    {
      name: "set_volume",
      description: "Set the playback volume (0-100%). Requires a Spotify Premium account.",
      inputSchema: {
        type: "object",
        properties: {
          volumePercent: {
            type: "number",
            description: "Volume level from 0 (mute) to 100 (max)",
          },
          deviceId: {
            type: "string",
            description: "Device ID to set volume on (from get_devices). Uses active device if omitted.",
          },
        },
        required: ["volumePercent"],
      },
    },
    {
      name: "get_devices",
      description:
        "List all available Spotify Connect devices (phones, computers, speakers, etc.) with their IDs, names, types, and active status.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "transfer_playback",
      description:
        "Transfer playback to a different Spotify Connect device. Use device IDs from get_devices.",
      inputSchema: {
        type: "object",
        properties: {
          deviceId: {
            type: "string",
            description: "Device ID to transfer playback to (from get_devices)",
          },
          play: {
            type: "boolean",
            description: "Whether to start playing immediately after transfer (default: false)",
          },
        },
        required: ["deviceId"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  const wrap = (result: unknown, isError = false) => ({
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    ...(isError ? { isError: true } : {}),
  });

  try {
    const c = getClient();

    switch (name) {
      // Auth
      case "spotify_status":
        return wrap(await c.status());

      case "spotify_auth":
        return wrap(await c.authorize());

      case "spotify_logout":
        return wrap(await c.logout());

      // Search
      case "search_tracks":
        return wrap(
          await c.searchTracks(a.query as string, (a.limit as number | undefined) ?? 20)
        );

      case "search_artists":
        return wrap(
          await c.searchArtists(a.query as string, (a.limit as number | undefined) ?? 20)
        );

      case "search_albums":
        return wrap(
          await c.searchAlbums(a.query as string, (a.limit as number | undefined) ?? 20)
        );

      case "search_playlists":
        return wrap(
          await c.searchPlaylists(a.query as string, (a.limit as number | undefined) ?? 20)
        );

      // Playlists
      case "get_playlists":
        return wrap(await c.getPlaylists((a.limit as number | undefined) ?? 50));

      case "create_playlist":
        return wrap(
          await c.createPlaylist(
            a.name as string,
            a.description as string | undefined,
            (a.public as boolean | undefined) ?? false
          )
        );

      case "add_to_playlist":
        return wrap(
          await c.addToPlaylist(
            a.playlistId as string,
            a.uris as string[],
            a.position as number | undefined
          )
        );

      case "remove_from_playlist":
        return wrap(
          await c.removeFromPlaylist(a.playlistId as string, a.uris as string[])
        );

      // Playback
      case "get_currently_playing":
        return wrap(await c.getCurrentlyPlaying());

      case "play":
        return wrap(
          await c.play({
            deviceId: a.deviceId as string | undefined,
            contextUri: a.contextUri as string | undefined,
            uris: a.uris as string[] | undefined,
            offset: a.offsetPosition !== undefined
              ? { position: a.offsetPosition as number }
              : undefined,
            positionMs: a.positionMs as number | undefined,
          })
        );

      case "pause":
        return wrap(await c.pause(a.deviceId as string | undefined));

      case "next_track":
        return wrap(await c.nextTrack(a.deviceId as string | undefined));

      case "previous_track":
        return wrap(await c.previousTrack(a.deviceId as string | undefined));

      case "set_volume":
        return wrap(
          await c.setVolume(a.volumePercent as number, a.deviceId as string | undefined)
        );

      case "get_devices":
        return wrap(await c.getDevices());

      case "transfer_playback":
        return wrap(
          await c.transferPlayback(a.deviceId as string, (a.play as boolean | undefined) ?? false)
        );

      default:
        return wrap({ success: false, error: `Unknown tool: ${name}` }, true);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return wrap({ success: false, error: msg }, true);
  }
});

// Cleanup on exit
async function shutdown() {
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Strider Spotify MCP server running");
}

main().catch(console.error);
