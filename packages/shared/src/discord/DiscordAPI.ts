import { CDN, DiscordAPIError, REST } from '@discordjs/rest';
import {
  RESTGetAPIChannelResult,
  RESTGetAPIUserResult,
  RESTJSONErrorCodes,
  Routes,
} from 'discord-api-types/v9';
import env from '../env';
import logger from '../logger';

export interface DiscordUser extends RESTGetAPIUserResult {
  avatarUrl?: string
}

let user: DiscordUser;

class DiscordAPI extends REST {
  async getCurrentUser() {
    if (!user) {
      user = await this.get(Routes.user()) as RESTGetAPIUserResult;
      user.avatarUrl = new CDN().avatar(user.id, user.avatar!);
    }

    return user;
  }

  async getChannelName(channelId: string) {
    let channelName;

    try {
      channelName = (
        await this.get(Routes.channel(channelId)) as RESTGetAPIChannelResult
      ).name!;
    } catch (err) {
      const error = err as DiscordAPIError;

      switch (error.code) {
        case RESTJSONErrorCodes.MissingAccess:
          channelName = '[hidden]';
          break;
        case RESTJSONErrorCodes.UnknownChannel:
          channelName = '[deleted]';
          break;
        default:
          channelName = '[unknown]';
          logger.error({
            message: error.message,
            channelId,
            err,
          });
      }
    }

    return channelName;
  }
}

export default new DiscordAPI({ version: '9' }).setToken(env.discord.token);
