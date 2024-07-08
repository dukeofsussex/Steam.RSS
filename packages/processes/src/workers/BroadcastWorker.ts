import { R_OK, W_OK } from 'node:constants';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Knex } from 'knex';
import { ButtonStyle, ComponentType } from 'slash-create';
import {
  db,
  env,
  INVITE_URL,
  logger,
  REPO_URL,
  WEBSITE_URL,
} from '@steamwatch/shared';
import Worker from './Worker';
import type MessageQueue from '../MessageQueue';
import type { QueuedMessage } from '../MessageQueue';

const FILE = join(__dirname, '..', '..', 'data', 'broadcast.json');

export default class BroadcastWorker extends Worker {
  private messageQueue: MessageQueue;

  constructor(queue: MessageQueue) {
    super(3600000); // 60m
    this.messageQueue = queue;
  }

  async work(): Promise<void> {
    let message: QueuedMessage['message'];
    let active: boolean;

    try {
      await access(FILE, R_OK | W_OK);
      ({ active, message } = JSON.parse((await readFile(FILE)).toString()));
    } catch {
      logger.warn('No broadcast found');
      return;
    }

    if (!active) {
      logger.info('Skipping inactive broadcast...');
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
      .from((fromBuilder: Knex.QueryBuilder) => fromBuilder.select('pg.guild_id', 'channel_id', 'thread_id', db.raw('COUNT(channel_id) AS countPerChannel'), db.raw('maxPerGuild'))
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

    logger.info(`Queueing broadcast for ${channels.length} guilds...`);

    for (let i = 0; i < channels.length; i += 1) {
      const channel = channels[i];

      this.messageQueue.enqueue({
        id: channel.webhookId,
        threadId: channel.threadId,
        token: channel.webhookToken,
        message,
      });
    }

    await writeFile(FILE, JSON.stringify({
      active: false,
      message,
    }, null, 2));

    logger.info('Broadcast queued, stopping...');

    super.stop();
  }
}
