import fetch from 'node-fetch';
import env from '../utils/env';
import logger from '../utils/logger';

export enum CommunityVisibilityState {
  Private = 1,
  'Friends Only' = 2,
  Public = 3,
}

interface AppDetails {
  achievements?: Total;
  categories?: Tag[];
  developers: string[];
  genres?: Tag[];
  header_image: string;
  is_free: boolean;
  name: string;
  platforms: {
    windows: boolean;
    mac: boolean;
    linux: boolean;
  }
  publishers?: string[];
  price_overview?: PriceOverview;
  recommendations?: Total;
  release_date: {
    coming_soon: boolean;
    date: string;
  }
  short_description: string;
  type: string;
  website: string | null;
}

interface AppNews {
  appnews: {
    newsitems: NewsPost[];
  }
}

export interface KeyedAppDetails {
  [key: number]: {
    success: boolean;
    data: AppDetails;
  }
}

export interface NewsPost {
  appid: number;
  author: string;
  contents: string;
  date: number;
  feedlabel: string;
  feedname: string;
  feed_type: number;
  gid: string;
  is_external_url: boolean;
  title: string;
  url: string;
}

interface NumberOfCurrentPlayers {
  player_count: number;
}

interface OwnedGame {
  appid: number;
}

interface OwnedGames {
  games: OwnedGame[];
}

interface PlayerBans {
  CommunityBanned: boolean;
  DaysSinceLastBan: number;
  EconomyBan: string;
  NumberOfGameBans: number;
  NumberOfVACBans: number;
  VACBanned: boolean;
}

interface PlayersResponse<T> {
  players: T[];
}

interface PlayerSummary {
  avatarfull: string;
  communityvisibilitystate: number;
  lastlogoff: number;
  loccountrycode?: string;
  personaname: string;
  profilestate: number;
  profileurl: string;
  steamid: string;
}

export interface PriceOverview {
  currency: string;
  initial: number;
  final: number;
  discount_percent: number;
  initial_formatted: string;
  final_formatted: string;
}

interface Response<T> {
  response: T;
}

interface SearchResult {
  total: number;
  items: {
    id: number;
  }[];
}

interface SteamLevel {
  player_level: number;
}

interface Tag {
  description: string;
}

interface Total {
  total: number;
}

interface VanityURLResolve {
  steamid?: string;
}

const APP_ID_REGEX = /app\/(\d+)/;

export default class SteamAPI {
  static async getAppDetails(appId: number, cc: string) {
    const res = await this.request<KeyedAppDetails>(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${cc}`);
    return res?.[appId].data || null;
  }

  static async getAppNews(appId: number) {
    const res = await this.request<AppNews>(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2?appid=${appId}&count=1`);

    if (!res?.appnews?.newsitems?.[0]) {
      return null;
    }

    const post = res!.appnews.newsitems[0];
    post.url = encodeURI(post.url);
    return post;
  }

  static async getAppPrices(appIds: number[], cc: string) {
    return this.request<KeyedAppDetails>(`https://store.steampowered.com/api/appdetails?appids=${appIds.join(',')}&filters=price_overview&cc=${cc}`);
  }

  static async getNumberOfCurrentPlayers(appId: number) {
    const res = await this.request<Response<NumberOfCurrentPlayers>>(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appId}`);
    return res?.response.player_count || null;
  }

  static async getOwnedGames(steamId: string) {
    const res = await this.request<Response<OwnedGames>>(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${env.steamWebApiKey}&steamid=${steamId}&include_played_free_games=true`);
    return res?.response.games || null;
  }

  static async getPlayerBans(steamId: string) {
    const res = await this.request<PlayersResponse<PlayerBans>>(`https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${env.steamWebApiKey}&steamids=${steamId}`);
    return res?.players[0] || null;
  }

  static async getPlayerSummary(steamId: string) {
    const res = await this.request<Response<PlayersResponse<PlayerSummary>>>(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${env.steamWebApiKey}&steamids=${steamId}`);
    return res?.response.players[0] || null;
  }

  static async getRandom() {
    const res = await fetch('http://store.steampowered.com/explore/random/', {
      method: 'HEAD',
    });

    const appId = res.url.match(APP_ID_REGEX)?.[1];

    return appId ? parseInt(appId, 10) : null;
  }

  static async getSteamLevel(steamId: string) {
    const res = await this.request<Response<SteamLevel>>(`https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${env.steamWebApiKey}&steamid=${steamId}`);
    return res?.response.player_level || null;
  }

  static async resolveVanityUrl(vanityUrlName: string) {
    const res = await this.request<Response<VanityURLResolve>>(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${env.steamWebApiKey}&vanityurl=${vanityUrlName}`);
    return res?.response.steamid || null;
  }

  static async searchStore(term: string) {
    const res = await this.request<SearchResult>(`https://store.steampowered.com/api/storesearch/?term=${term}&cc=US`);
    return res?.total ? res.items[0].id : null;
  }

  private static async request<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url);
      return await res.json() as T;
    } catch (err) {
      logger.error({
        group: 'SteamAPI',
        err,
      });
      return null;
    }
  }
}