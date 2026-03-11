/**
 * Spotify Web API Client
 *
 * Wraps the Spotify Web API with automatic token refresh,
 * PKCE OAuth flow, and typed responses for all supported operations.
 */

import { chromium } from "playwright";
import crypto from "crypto";
import {
  loadTokens,
  saveTokens,
  clearTokens,
  isTokenExpired,
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
  waitForCallback,
  exchangeCodeForTokens,
  refreshTokens,
  type SpotifyTokens,
} from "./auth.js";

const API_BASE = "https://api.spotify.com/v1";

export interface SpotifyStatus {
  authenticated: boolean;
  clientId: string | null;
  userId?: string;
  displayName?: string;
  email?: string;
  tokensPath?: string;
  expiresAt?: string;
}

export interface Track {
  id: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
  uri: string;
  previewUrl?: string;
  explicit: boolean;
  popularity?: number;
}

export interface Artist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  followers: number;
  uri: string;
}

export interface Album {
  id: string;
  name: string;
  artists: string[];
  releaseDate: string;
  totalTracks: number;
  uri: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  owner: string;
  public: boolean;
  collaborative: boolean;
  totalTracks: number;
  uri: string;
}

export interface Device {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isPrivateSession: boolean;
  isRestricted: boolean;
  volumePercent: number | null;
}

export interface CurrentlyPlaying {
  isPlaying: boolean;
  track?: Track;
  progressMs?: number;
  device?: Device;
  shuffleState?: boolean;
  repeatState?: string;
  context?: { type: string; uri: string };
}

export class SpotifyClient {
  private tokens: SpotifyTokens | null = null;
  private clientId: string;

  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
    this.tokens = loadTokens();
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async status(): Promise<SpotifyStatus> {
    const tokensPath = (await import("./auth.js")).getTokensPath();

    if (!this.clientId) {
      return { authenticated: false, clientId: null };
    }

    if (!this.tokens) {
      return { authenticated: false, clientId: this.clientId, tokensPath };
    }

    try {
      await this.ensureToken();
      const me = await this.get<{ id: string; display_name: string; email: string }>("/me");
      return {
        authenticated: true,
        clientId: this.clientId,
        userId: me.id,
        displayName: me.display_name,
        email: me.email,
        tokensPath,
        expiresAt: new Date(this.tokens!.expires_at).toISOString(),
      };
    } catch {
      return { authenticated: false, clientId: this.clientId, tokensPath };
    }
  }

  async authorize(): Promise<{ success: boolean; message: string; authUrl?: string }> {
    if (!this.clientId) {
      return {
        success: false,
        message: "SPOTIFY_CLIENT_ID environment variable is not set. Please set it and restart the MCP server.",
      };
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString("hex");
    const authUrl = buildAuthUrl(this.clientId, codeChallenge, state);

    // Try to open browser with Playwright
    let browser;
    try {
      browser = await chromium.launch({ headless: false });
      const page = await browser.newPage();
      await page.goto(authUrl);

      // Wait for callback in parallel
      const callbackPromise = waitForCallback(8888);

      // Wait for callback
      const { code, state: returnedState } = await callbackPromise;
      await browser.close();
      browser = undefined;

      if (returnedState !== state) {
        return { success: false, message: "OAuth state mismatch — possible CSRF attack. Please try again." };
      }

      const tokens = await exchangeCodeForTokens(this.clientId, code, codeVerifier);
      saveTokens(tokens);
      this.tokens = tokens;

      const me = await this.get<{ display_name: string; email: string }>("/me");
      return {
        success: true,
        message: `Successfully authenticated as ${me.display_name} (${me.email})`,
      };
    } catch (err) {
      if (browser) await browser.close().catch(() => {});
      // Fallback: return URL for manual auth
      return {
        success: false,
        message: `Browser launch failed. Please open this URL manually to authorize:\n${authUrl}\n\nMake sure a local server is listening on port 8888.`,
        authUrl,
      };
    }
  }

  async logout(): Promise<{ success: boolean; message: string }> {
    clearTokens();
    this.tokens = null;
    return { success: true, message: "Logged out. Tokens cleared." };
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async searchTracks(query: string, limit = 20): Promise<{ tracks: Track[]; total: number }> {
    const data = await this.get<{ tracks: { items: SpotifyApi.TrackObject[]; total: number } }>(
      `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`
    );
    return {
      tracks: data.tracks.items.map(this.mapTrack),
      total: data.tracks.total,
    };
  }

  async searchArtists(query: string, limit = 20): Promise<{ artists: Artist[]; total: number }> {
    const data = await this.get<{ artists: { items: SpotifyApi.ArtistObject[]; total: number } }>(
      `/search?q=${encodeURIComponent(query)}&type=artist&limit=${limit}`
    );
    return {
      artists: data.artists.items.map(this.mapArtist),
      total: data.artists.total,
    };
  }

  async searchAlbums(query: string, limit = 20): Promise<{ albums: Album[]; total: number }> {
    const data = await this.get<{ albums: { items: SpotifyApi.AlbumObject[]; total: number } }>(
      `/search?q=${encodeURIComponent(query)}&type=album&limit=${limit}`
    );
    return {
      albums: data.albums.items.map(this.mapAlbum),
      total: data.albums.total,
    };
  }

  async searchPlaylists(query: string, limit = 20): Promise<{ playlists: Playlist[]; total: number }> {
    const data = await this.get<{ playlists: { items: SpotifyApi.PlaylistObject[]; total: number } }>(
      `/search?q=${encodeURIComponent(query)}&type=playlist&limit=${limit}`
    );
    return {
      playlists: data.playlists.items.map(this.mapPlaylist),
      total: data.playlists.total,
    };
  }

  // ── Playlists ─────────────────────────────────────────────────────────────

  async getPlaylists(limit = 50): Promise<{ playlists: Playlist[]; total: number }> {
    const data = await this.get<{ items: SpotifyApi.PlaylistObject[]; total: number }>(
      `/me/playlists?limit=${limit}`
    );
    return {
      playlists: data.items.map(this.mapPlaylist),
      total: data.total,
    };
  }

  async createPlaylist(
    name: string,
    description?: string,
    isPublic = false
  ): Promise<{ success: boolean; playlist: Playlist }> {
    const me = await this.get<{ id: string }>("/me");
    const data = await this.post<SpotifyApi.PlaylistObject>(`/users/${me.id}/playlists`, {
      name,
      description: description ?? "",
      public: isPublic,
      collaborative: false,
    });
    return { success: true, playlist: this.mapPlaylist(data) };
  }

  async addToPlaylist(
    playlistId: string,
    uris: string[],
    position?: number
  ): Promise<{ success: boolean; snapshotId: string }> {
    const body: Record<string, unknown> = { uris };
    if (position !== undefined) body.position = position;
    const data = await this.post<{ snapshot_id: string }>(`/playlists/${playlistId}/tracks`, body);
    return { success: true, snapshotId: data.snapshot_id };
  }

  async removeFromPlaylist(
    playlistId: string,
    uris: string[]
  ): Promise<{ success: boolean; snapshotId: string }> {
    const data = await this.delete<{ snapshot_id: string }>(`/playlists/${playlistId}/tracks`, {
      tracks: uris.map((uri) => ({ uri })),
    });
    return { success: true, snapshotId: data.snapshot_id };
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  async getCurrentlyPlaying(): Promise<CurrentlyPlaying> {
    const data = await this.get<SpotifyApi.CurrentlyPlayingObject | null>("/me/player");
    if (!data) return { isPlaying: false };

    return {
      isPlaying: data.is_playing,
      track: data.item ? this.mapTrack(data.item as SpotifyApi.TrackObject) : undefined,
      progressMs: data.progress_ms ?? undefined,
      device: data.device ? this.mapDevice(data.device) : undefined,
      shuffleState: data.shuffle_state ?? undefined,
      repeatState: data.repeat_state ?? undefined,
      context: data.context
        ? { type: data.context.type, uri: data.context.uri }
        : undefined,
    };
  }

  async play(options?: {
    deviceId?: string;
    contextUri?: string;
    uris?: string[];
    offset?: { position?: number; uri?: string };
    positionMs?: number;
  }): Promise<{ success: boolean; message: string }> {
    const params = options?.deviceId ? `?device_id=${options.deviceId}` : "";
    const body: Record<string, unknown> = {};
    if (options?.contextUri) body.context_uri = options.contextUri;
    if (options?.uris) body.uris = options.uris;
    if (options?.offset) body.offset = options.offset;
    if (options?.positionMs !== undefined) body.position_ms = options.positionMs;

    await this.put(`/me/player/play${params}`, Object.keys(body).length > 0 ? body : undefined);
    return { success: true, message: "Playback started" };
  }

  async pause(deviceId?: string): Promise<{ success: boolean; message: string }> {
    const params = deviceId ? `?device_id=${deviceId}` : "";
    await this.put(`/me/player/pause${params}`);
    return { success: true, message: "Playback paused" };
  }

  async nextTrack(deviceId?: string): Promise<{ success: boolean; message: string }> {
    const params = deviceId ? `?device_id=${deviceId}` : "";
    await this.post(`/me/player/next${params}`, {});
    return { success: true, message: "Skipped to next track" };
  }

  async previousTrack(deviceId?: string): Promise<{ success: boolean; message: string }> {
    const params = deviceId ? `?device_id=${deviceId}` : "";
    await this.post(`/me/player/previous${params}`, {});
    return { success: true, message: "Went to previous track" };
  }

  async setVolume(volumePercent: number, deviceId?: string): Promise<{ success: boolean; message: string }> {
    const vol = Math.max(0, Math.min(100, Math.round(volumePercent)));
    const params = new URLSearchParams({ volume_percent: String(vol) });
    if (deviceId) params.set("device_id", deviceId);
    await this.put(`/me/player/volume?${params}`);
    return { success: true, message: `Volume set to ${vol}%` };
  }

  async getDevices(): Promise<{ devices: Device[] }> {
    const data = await this.get<{ devices: SpotifyApi.DeviceObject[] }>("/me/player/devices");
    return { devices: data.devices.map(this.mapDevice) };
  }

  async transferPlayback(deviceId: string, play = false): Promise<{ success: boolean; message: string }> {
    await this.put("/me/player", { device_ids: [deviceId], play });
    return { success: true, message: `Playback transferred to device ${deviceId}` };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async ensureToken(): Promise<void> {
    if (!this.tokens) throw new Error("Not authenticated. Call spotify_auth first.");
    if (isTokenExpired(this.tokens)) {
      this.tokens = await refreshTokens(this.clientId, this.tokens.refresh_token);
      saveTokens(this.tokens);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    await this.ensureToken();

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.tokens!.access_token}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204 || res.status === 202) {
      return undefined as unknown as T;
    }

    if (!res.ok) {
      let errorMsg = `Spotify API error: ${res.status}`;
      try {
        const errData = await res.json() as { error?: { message?: string } };
        if (errData?.error?.message) errorMsg += ` — ${errData.error.message}`;
      } catch { /* ignore */ }
      throw new Error(errorMsg);
    }

    // Empty body
    const text = await res.text();
    if (!text) return undefined as unknown as T;
    return JSON.parse(text) as T;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private put(path: string, body?: unknown): Promise<void> {
    return this.request<void>("PUT", path, body);
  }

  private delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("DELETE", path, body);
  }

  // ── Mappers ───────────────────────────────────────────────────────────────

  private mapTrack(t: SpotifyApi.TrackObject): Track {
    return {
      id: t.id,
      name: t.name,
      artists: t.artists.map((a) => a.name),
      album: t.album?.name ?? "",
      durationMs: t.duration_ms,
      uri: t.uri,
      previewUrl: t.preview_url ?? undefined,
      explicit: t.explicit,
      popularity: t.popularity,
    };
  }

  private mapArtist(a: SpotifyApi.ArtistObject): Artist {
    return {
      id: a.id,
      name: a.name,
      genres: a.genres ?? [],
      popularity: a.popularity ?? 0,
      followers: a.followers?.total ?? 0,
      uri: a.uri,
    };
  }

  private mapAlbum(a: SpotifyApi.AlbumObject): Album {
    return {
      id: a.id,
      name: a.name,
      artists: a.artists.map((ar) => ar.name),
      releaseDate: a.release_date,
      totalTracks: a.total_tracks,
      uri: a.uri,
    };
  }

  private mapPlaylist(p: SpotifyApi.PlaylistObject): Playlist {
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? undefined,
      owner: p.owner?.display_name ?? p.owner?.id ?? "",
      public: p.public ?? false,
      collaborative: p.collaborative,
      totalTracks: p.tracks?.total ?? 0,
      uri: p.uri,
    };
  }

  private mapDevice(d: SpotifyApi.DeviceObject): Device {
    return {
      id: d.id ?? "",
      name: d.name,
      type: d.type,
      isActive: d.is_active,
      isPrivateSession: d.is_private_session,
      isRestricted: d.is_restricted,
      volumePercent: d.volume_percent ?? null,
    };
  }
}

// Minimal Spotify API type stubs (avoid full @types/spotify-api dependency)
declare namespace SpotifyApi {
  interface TrackObject {
    id: string;
    name: string;
    artists: { id: string; name: string }[];
    album: { name: string } | null;
    duration_ms: number;
    uri: string;
    preview_url: string | null;
    explicit: boolean;
    popularity?: number;
  }

  interface ArtistObject {
    id: string;
    name: string;
    genres?: string[];
    popularity?: number;
    followers?: { total: number };
    uri: string;
  }

  interface AlbumObject {
    id: string;
    name: string;
    artists: { name: string }[];
    release_date: string;
    total_tracks: number;
    uri: string;
  }

  interface PlaylistObject {
    id: string;
    name: string;
    description?: string | null;
    owner: { id: string; display_name?: string };
    public?: boolean | null;
    collaborative: boolean;
    tracks?: { total: number };
    uri: string;
  }

  interface DeviceObject {
    id?: string | null;
    name: string;
    type: string;
    is_active: boolean;
    is_private_session: boolean;
    is_restricted: boolean;
    volume_percent?: number | null;
  }

  interface CurrentlyPlayingObject {
    is_playing: boolean;
    item: TrackObject | null;
    progress_ms?: number | null;
    device: DeviceObject;
    shuffle_state?: boolean | null;
    repeat_state?: string | null;
    context?: { type: string; uri: string; href: string } | null;
  }
}
