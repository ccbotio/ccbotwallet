import type { Context } from 'grammy';

export type BotContext = Context;

export interface SessionData {
  step?: string;
  data?: Record<string, unknown>;
}
