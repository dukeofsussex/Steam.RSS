import type { DiscordAPIError } from '@discordjs/rest';
import { RESTJSONErrorCodes, RESTPostAPIWebhookWithTokenResult, Routes } from 'discord-api-types/v10';
import { R_OK, W_OK } from 'node:constants';
import { access, readFile, writeFile } from 'node:fs/promises';
import type { Response } from 'node-fetch';
import type { EditMessageOptions } from 'slash-create';
import {
  db,
  DiscordAPI,
  DiscordUser,
  logger,
  Manager,
} from '@steamwatch/shared';

const FILENAME = 'queue.json';
const SLOWMODE_DELAY = 300000; // 5m

export interface QueuedItem {
  id: string;
  token: string;
  threadId: string | null;
  message: Pick<EditMessageOptions, 'content' | 'embeds' | 'components'>;
}

export default class MessageQueue implements Manager {
  private backupInterval?: NodeJS.Timeout;

  private offset: number;

  private queue: QueuedItem[];

  private queueDelay: number;

  private queueTimeout?: NodeJS.Timeout | null;

  private user?: DiscordUser;

  constructor() {
    this.offset = 0;
    this.queue = [];
    this.queueDelay = 250; // 0.25s
  }

  enqueue(id: string, token: string, threadId: string | null, message: QueuedItem['message']) {
    this.queue.push({
      id,
      token,
      threadId,
      message,
    });

    if (!this.queueTimeout) {
      this.queueTimeout = setTimeout(() => this.notify(), this.queueDelay);
    }
  }

  async start() {
    this.user = await DiscordAPI.getCurrentUser();

    try {
      // eslint-disable-next-line no-bitwise
      await access(FILENAME, R_OK | W_OK);
      const { offset, queue } = JSON.parse((await readFile(FILENAME)).toString());
      this.offset = offset;
      this.queue = queue;

      if (this.queueSize()) {
        this.queueTimeout = setTimeout(() => this.notify(), this.queueDelay);
      }

      logger.info({
        message: 'Queue file found',
        length: this.queueSize(),
      });
    } catch {
      logger.warn('No queue file found');
    }

    this.backupInterval = setInterval(() => this.backupQueue(), 60000); // 1m
  }

  async stop() {
    logger.info({
      message: 'Stopping queue',
      length: this.queueSize(),
    });

    await this.backupQueue();

    if (this.backupInterval) {
      clearInterval(this.backupInterval);
    }

    if (this.queueTimeout) {
      clearTimeout(this.queueTimeout);
      this.queueTimeout = null;
    }
  }

  backupQueue() {
    logger.info({
      message: 'Backing up queue',
      length: this.queueSize(),
    });

    return writeFile(FILENAME, JSON.stringify({
      offset: this.offset,
      queue: this.queue,
    }));
  }

  private dequeue() {
    if (this.queueSize() === 0) {
      return null;
    }

    const item = this.queue[this.offset];
    this.offset += 1;

    if (this.offset * 2 >= this.queue.length) {
      this.queue = this.queue.slice(this.offset);
      this.offset = 0;
    }

    return item;
  }

  private async notify() {
    const {
      id,
      message,
      threadId,
      token,
    } = this.dequeue()!;

    try {
      await DiscordAPI.post(Routes.webhook(id, token), {
        ...(threadId ? {
          query: new URLSearchParams({
            thread_id: threadId,
          }),
        } : {}),
        body: {
          content: message.content,
          username: this.user!.username,
          avatar_url: this.user!.avatarUrl,
          embeds: message.embeds || [],
          components: message.components || [],
        },
      }) as RESTPostAPIWebhookWithTokenResult;
    } catch (err) {
      if ((err as DiscordAPIError).code === RESTJSONErrorCodes.UnknownWebhook) {
        await MessageQueue.purgeWebhook(id);
      } else {
        logger.error({
          message: 'Unable to send webhook request',
          id,
          token,
          body: message,
          err,
        });

        this.queue.push({
          id,
          message,
          threadId,
          token,
        });

        const res = err as Response;

        if (res.status >= 500) {
          logger.warn({
            message: 'Discord is having issues, slowing down...',
            res,
          });

          this.queueTimeout = setTimeout(() => this.notify(), SLOWMODE_DELAY);
          return;
        }
      }
    }

    if (this.queueSize()) {
      this.queueTimeout = setTimeout(() => this.notify(), this.queueDelay);
    } else if (this.queueTimeout) {
      clearTimeout(this.queueTimeout);
      this.queueTimeout = null;
    }
  }

  private queueSize() {
    return this.queue.length - this.offset;
  }

  private static async purgeWebhook(id: string) {
    logger.info({
      message: 'Purging expired webhook',
      id,
    });
    return db.delete()
      .from('channel_webhook')
      .where('webhookId', id);
  }
}
