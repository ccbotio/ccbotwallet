import { InlineKeyboard } from 'grammy';
import { env } from '../../config/env.js';

export function openWalletKeyboard() {
  return new InlineKeyboard().webApp('Launch App', env.TELEGRAM_MINI_APP_URL ?? '');
}

export function mainMenuKeyboard() {
  return new InlineKeyboard().webApp('Launch App', env.TELEGRAM_MINI_APP_URL ?? '');
}

export function sendKeyboard() {
  return new InlineKeyboard()
    .text('CC', 'send:token:CC')
    .text('USDC', 'send:token:USDC')
    .text('ETH', 'send:token:ETH')
    .row()
    .text('Cancel', 'cancel');
}

export function confirmKeyboard() {
  return new InlineKeyboard().text('Confirm', 'confirm').text('Cancel', 'cancel');
}

export function backKeyboard() {
  return new InlineKeyboard().text('Back', 'back');
}
