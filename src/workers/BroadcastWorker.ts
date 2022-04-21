import { Knex } from 'knex';
import { R_OK, W_OK } from 'node:constants';
import { access, readFile, writeFile } from 'node:fs/promises';
import { ButtonStyle, ComponentType } from 'slash-create';
import { INVITE_URL, REPO_URL, WEBSITE_URL } from '../utils/constants';
import env from '../utils/env';
import logger from '../utils/logger';
import db from '../db';
import MessageQueue, { QueuedItem } from '../utils/MessageQueue';
import Worker from './Worker';

const FILENAME = 'broadcast.json';

export default class BroadcastWorker extends Worker {
  private messageQueue: MessageQueue;

  constructor(messageQueue: MessageQueue) {
    super(3600000); // 60m
    this.messageQueue = messageQueue;
  }

  async work(): Promise<void> {
    let message: QueuedItem['message'];
    let active: boolean;

    try {
      // eslint-disable-next-line no-bitwise
      await access(FILENAME, R_OK | W_OK);
      ({ active, message } = JSON.parse((await readFile(FILENAME)).toString()));
    } catch {
      logger.error({
        group: 'Broadcaster',
        message: 'No broadcast found',
      });
      return;
    }

    if (!active) {
      logger.info({
        group: 'Broadcaster',
        message: 'Skipping inactive broadcast...',
      });
      return;
    }

    if (message.embeds) {
      message.embeds.forEach((e) => {
        e.timestamp = new Date();
      });
    }

    message.components = [{
      type: ComponentType.ACTION_ROW,
      components: [{
        type: ComponentType.BUTTON,
        style: ButtonStyle.LINK,
        label: 'Invite',
        url: INVITE_URL,
        emoji: {
          name: '\uD83D\uDCE8',
        },
      }, {
        type: ComponentType.BUTTON,
        style: ButtonStyle.LINK,
        label: 'GitHub Repo',
        url: REPO_URL,
      }, {
        type: ComponentType.BUTTON,
        style: ButtonStyle.LINK,
        label: 'Support',
        url: env.discord.invite,
      }, {
        type: ComponentType.BUTTON,
        style: ButtonStyle.LINK,
        label: 'Website',
        url: WEBSITE_URL,
      }],
    }];

    const channels = await db.select('channel_webhook.*')
      .from((fromBuilder: Knex.QueryBuilder) => fromBuilder.select('pg.guild_id', 'channel_id', db.raw('COUNT(channel_id) AS countPerChannel'), db.raw('maxPerGuild'))
        .from('watcher')
        .innerJoin('channel_webhook', 'channel_webhook.id', 'watcher.channel_id')
        .innerJoin(db.select('guild_id', db.raw('MAX(countPerChannel) AS maxPerGuild'))
          .from((builder: Knex.QueryBuilder) => builder.select('channel_id', 'guild_id', db.raw('COUNT(channel_id) AS countPerChannel'))
            .from('watcher')
            .innerJoin('channel_webhook', 'channel_webhook.id', 'watcher.channel_id')
            .groupBy('channel_id')
            .as('pc'))
          .groupBy('guild_id')
          .as('pg'), 'pg.guild_id', 'channel_webhook.guild_id')
        .groupBy('channel_id')
        .as('ic'))
      .innerJoin('channel_webhook', 'channel_webhook.id', 'ic.channel_id')
      .whereRaw('countPerChannel = maxPerGuild')
      .groupBy('guild_id');

    logger.info({
      group: 'Broadcaster',
      message: `Queueing broadcast for ${channels.length} guilds...`,
    });

    for (let i = 0; i < channels.length; i += 1) {
      const channel = channels[i];

      this.messageQueue.enqueue(channel.webhookId, channel.webhookToken, message);
    }

    await writeFile(FILENAME, JSON.stringify({
      active: false,
      message,
    }, null, 2));

    await this.messageQueue.backupQueue();

    logger.info({
      group: 'Broadcaster',
      message: 'Broadcast queued, stopping...',
    });

    super.stop();
  }
}