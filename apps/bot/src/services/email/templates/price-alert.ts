/**
 * Price Alert Email Templates
 *
 * Email templates for CC price change notifications.
 */

import { baseTemplate } from './base.js';

export interface PriceAlertProps {
  token: string;
  currentPrice: string;
  previousPrice: string;
  changePercent: string;
  changeDirection: 'up' | 'down';
  timestamp: Date;
  high24h?: string;
  low24h?: string;
  volume24h?: string;
  marketCap?: string;
}

export interface PriceTargetReachedProps {
  token: string;
  targetPrice: string;
  currentPrice: string;
  targetType: 'above' | 'below';
  timestamp: Date;
}

/**
 * Email template for significant price changes
 */
export const priceAlertTemplate = (props: PriceAlertProps): string => {
  const {
    token,
    currentPrice,
    previousPrice,
    changePercent,
    changeDirection,
    timestamp,
    high24h,
    low24h,
    volume24h,
    marketCap,
  } = props;

  const formattedDate = timestamp.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const formattedTime = timestamp.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const isUp = changeDirection === 'up';
  const arrowIcon = isUp ? '↑' : '↓';
  const colorClass = isUp ? '#22c55e' : '#ef4444';
  const bgColor = isUp ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';
  const borderColor = isUp ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';

  const content = `
    <!-- Icon -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <div style="width: 64px; height: 64px; background-color: ${bgColor}; border-radius: 16px; display: inline-block; line-height: 64px; text-align: center;">
            <span style="font-size: 28px;">${arrowIcon}</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Title -->
    <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
      ${token} Price ${isUp ? 'Increased' : 'Decreased'}
    </h1>
    <p style="margin: 0 0 32px 0; color: #6b6b7a; font-size: 15px; text-align: center;">
      Significant price movement detected
    </p>

    <!-- Price Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 16px; padding: 24px; text-align: center;">
          <p style="margin: 0 0 8px 0; color: #6b6b7a; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">
            Current Price
          </p>
          <p style="margin: 0 0 8px 0; color: #ffffff; font-size: 36px; font-weight: 700;">
            ${currentPrice}
          </p>
          <p style="margin: 0; color: ${colorClass}; font-size: 18px; font-weight: 600;">
            ${isUp ? '+' : ''}${changePercent}% ${arrowIcon}
          </p>
          <p style="margin: 8px 0 0 0; color: #6b6b7a; font-size: 13px;">
            Previous: ${previousPrice}
          </p>
        </td>
      </tr>
    </table>

    <!-- Market Data -->
    ${(high24h || low24h || volume24h || marketCap) ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="background-color: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px;">

          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              ${high24h ? `
              <td style="width: 50%; padding-right: 8px;">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  24h High
                </p>
                <p style="margin: 0; color: #22c55e; font-size: 16px; font-weight: 600;">
                  ${high24h}
                </p>
              </td>
              ` : ''}
              ${low24h ? `
              <td style="width: 50%; padding-left: 8px;">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  24h Low
                </p>
                <p style="margin: 0; color: #ef4444; font-size: 16px; font-weight: 600;">
                  ${low24h}
                </p>
              </td>
              ` : ''}
            </tr>
          </table>

          ${(volume24h || marketCap) ? `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
            <tr>
              ${volume24h ? `
              <td style="width: 50%; padding-right: 8px;">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  24h Volume
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px; font-weight: 500;">
                  ${volume24h}
                </p>
              </td>
              ` : ''}
              ${marketCap ? `
              <td style="width: 50%; padding-left: 8px;">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Market Cap
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px; font-weight: 500;">
                  ${marketCap}
                </p>
              </td>
              ` : ''}
            </tr>
          </table>
          ` : ''}

        </td>
      </tr>
    </table>
    ` : ''}

    <!-- Timestamp -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="text-align: center;">
          <p style="margin: 0; color: #6b6b7a; font-size: 13px;">
            ${formattedDate} at ${formattedTime}
          </p>
        </td>
      </tr>
    </table>
  `;

  return baseTemplate({
    preheader: `${token} ${isUp ? 'increased' : 'decreased'} ${changePercent}% to ${currentPrice}`,
    content,
  });
};

/**
 * Email template for price target alerts
 */
export const priceTargetReachedTemplate = (props: PriceTargetReachedProps): string => {
  const {
    token,
    targetPrice,
    currentPrice,
    targetType,
    timestamp,
  } = props;

  const formattedDate = timestamp.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const formattedTime = timestamp.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const isAbove = targetType === 'above';

  const content = `
    <!-- Icon -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <div style="width: 64px; height: 64px; background-color: rgba(135, 92, 255, 0.2); border-radius: 16px; display: inline-block; line-height: 64px; text-align: center;">
            <span style="font-size: 28px;">🎯</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Title -->
    <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
      Price Target Reached
    </h1>
    <p style="margin: 0 0 32px 0; color: #6b6b7a; font-size: 15px; text-align: center;">
      ${token} has ${isAbove ? 'risen above' : 'fallen below'} your target
    </p>

    <!-- Target Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: rgba(135, 92, 255, 0.1); border: 1px solid rgba(135, 92, 255, 0.2); border-radius: 16px; padding: 24px; text-align: center;">
          <p style="margin: 0 0 8px 0; color: #6b6b7a; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">
            Your Target
          </p>
          <p style="margin: 0 0 16px 0; color: #875CFF; font-size: 28px; font-weight: 700;">
            ${targetPrice}
          </p>
          <div style="width: 100%; height: 1px; background-color: rgba(255, 255, 255, 0.1); margin: 16px 0;"></div>
          <p style="margin: 0 0 8px 0; color: #6b6b7a; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">
            Current Price
          </p>
          <p style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">
            ${currentPrice}
          </p>
        </td>
      </tr>
    </table>

    <!-- Timestamp -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="text-align: center;">
          <p style="margin: 0; color: #6b6b7a; font-size: 13px;">
            Alert triggered on ${formattedDate} at ${formattedTime}
          </p>
        </td>
      </tr>
    </table>

    <!-- CTA -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td align="center">
          <a href="#" style="display: inline-block; background-color: #875CFF; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 12px;">
            Open Wallet
          </a>
        </td>
      </tr>
    </table>
  `;

  return baseTemplate({
    preheader: `${token} has reached your price target of ${targetPrice}`,
    content,
  });
};
