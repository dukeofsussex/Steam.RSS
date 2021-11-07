import { stripIndents } from 'common-tags';
import fetch from 'node-fetch';
import Worker from './Worker';
import db from '../db';
import logger from '../utils/logger';

interface TopGGResponse {
  error?: string;
}

export default class TopGGWorker extends Worker {
  constructor() {
    super(1800000); // 30m
  }

  async work() {
    if (!process.env.TOPGG_TOKEN) {
      logger.warn({
        group: 'Worker',
        message: 'No token set for Top.gg, stopping...',
      });
      this.stop();
      return;
    }

    const count = await db.count('* AS count')
      .from('guild')
      .first()
      .then((res: any) => res.count);

    try {
      const res = await fetch('https://top.gg/api/bots/stats', {
        headers: {
          authorization: process.env.TOPGG_TOKEN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          server_count: count,
        }),
        method: 'POST',
      });
      const body = await res.json() as TopGGResponse;
      logger.log({
        group: 'Worker',
        message: body.error || 'Status updated',
        level: body.error ? 'error' : 'debug',
      });
    } catch (err) {
      logger.error({
        group: 'Worker',
        message: stripIndents`
          Unable to post bot stats to Top.gg!
          ${err}
        `,
      });
    }

    this.wait();
  }
}