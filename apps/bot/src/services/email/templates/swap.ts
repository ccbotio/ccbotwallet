/**
 * Swap Email Templates
 *
 * Email templates for token swap notifications.
 */

import { baseTemplate } from './base.js';

export interface SwapCompletedProps {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  rate: string;
  txHash: string;
  timestamp: Date;
  fee?: string;
  slippage?: string;
  explorerUrl?: string;
}

export interface SwapFailedProps {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  reason: string;
  timestamp: Date;
  txHash?: string;
}

/**
 * Email template for successful swap
 */
export const swapCompletedTemplate = (props: SwapCompletedProps): string => {
  const {
    fromToken,
    toToken,
    fromAmount,
    toAmount,
    rate,
    txHash,
    timestamp,
    fee,
    slippage,
    explorerUrl,
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

  const truncatedTxHash = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;

  const content = `
    <!-- Icon -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <div style="width: 64px; height: 64px; background-color: rgba(135, 92, 255, 0.2); border-radius: 16px; display: inline-block; line-height: 64px; text-align: center;">
            <span style="font-size: 28px;">⇄</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Title -->
    <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
      Swap Completed
    </h1>
    <p style="margin: 0 0 32px 0; color: #6b6b7a; font-size: 15px; text-align: center;">
      Your token swap has been executed successfully
    </p>

    <!-- Swap Details Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: rgba(135, 92, 255, 0.1); border: 1px solid rgba(135, 92, 255, 0.2); border-radius: 16px; padding: 24px;">

          <!-- From -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="text-align: center; padding-bottom: 16px;">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                  You Swapped
                </p>
                <p style="margin: 0; color: #ef4444; font-size: 28px; font-weight: 700;">
                  -${fromAmount} ${fromToken}
                </p>
              </td>
            </tr>
          </table>

          <!-- Arrow -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td align="center" style="padding: 8px 0;">
                <div style="width: 40px; height: 40px; background-color: rgba(255, 255, 255, 0.1); border-radius: 50%; line-height: 40px; text-align: center;">
                  <span style="color: #875CFF; font-size: 20px;">↓</span>
                </div>
              </td>
            </tr>
          </table>

          <!-- To -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="text-align: center; padding-top: 16px;">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                  You Received
                </p>
                <p style="margin: 0; color: #22c55e; font-size: 28px; font-weight: 700;">
                  +${toAmount} ${toToken}
                </p>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>

    <!-- Swap Info -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="background-color: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px;">

          <!-- Exchange Rate -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding-bottom: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Exchange Rate
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px; font-weight: 500;">
                  1 ${fromToken} = ${rate} ${toToken}
                </p>
              </td>
            </tr>
          </table>

          ${fee ? `
          <!-- Fee -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding: 16px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Network Fee
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px;">
                  ${fee}
                </p>
              </td>
            </tr>
          </table>
          ` : ''}

          ${slippage ? `
          <!-- Slippage -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding: 16px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Slippage
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px;">
                  ${slippage}
                </p>
              </td>
            </tr>
          </table>
          ` : ''}

          <!-- TX Hash -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding: 16px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Transaction Hash
                </p>
                <p style="margin: 0; color: #875CFF; font-size: 14px; font-family: monospace;">
                  ${truncatedTxHash}
                </p>
              </td>
            </tr>
          </table>

          <!-- Date & Time -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding-top: 16px;">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Date & Time
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px;">
                  ${formattedDate} at ${formattedTime}
                </p>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>

    <!-- View on Explorer Button -->
    ${explorerUrl ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td align="center">
          <a href="${explorerUrl}" target="_blank" style="display: inline-block; background-color: #875CFF; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 12px;">
            View on Explorer
          </a>
        </td>
      </tr>
    </table>
    ` : ''}
  `;

  return baseTemplate({
    preheader: `Swap completed: ${fromAmount} ${fromToken} → ${toAmount} ${toToken}`,
    content,
  });
};

/**
 * Email template for failed swap
 */
export const swapFailedTemplate = (props: SwapFailedProps): string => {
  const {
    fromToken,
    toToken,
    fromAmount,
    reason,
    timestamp,
    txHash,
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

  const content = `
    <!-- Icon -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <div style="width: 64px; height: 64px; background-color: rgba(239, 68, 68, 0.2); border-radius: 16px; display: inline-block; line-height: 64px; text-align: center;">
            <span style="font-size: 28px;">✕</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Title -->
    <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
      Swap Failed
    </h1>
    <p style="margin: 0 0 32px 0; color: #6b6b7a; font-size: 15px; text-align: center;">
      Your swap could not be completed
    </p>

    <!-- Error Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 16px; padding: 24px; text-align: center;">
          <p style="margin: 0 0 8px 0; color: #6b6b7a; font-size: 13px;">
            Attempted Swap
          </p>
          <p style="margin: 0 0 16px 0; color: #ffffff; font-size: 18px; font-weight: 600;">
            ${fromAmount} ${fromToken} → ${toToken}
          </p>
          <p style="margin: 0; color: #ef4444; font-size: 14px;">
            ${reason}
          </p>
        </td>
      </tr>
    </table>

    <!-- Details -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="background-color: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px;">

          ${txHash ? `
          <!-- TX Hash -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding-bottom: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Transaction Hash
                </p>
                <p style="margin: 0; color: #875CFF; font-size: 14px; font-family: monospace;">
                  ${txHash.slice(0, 10)}...${txHash.slice(-8)}
                </p>
              </td>
            </tr>
          </table>
          ` : ''}

          <!-- Date & Time -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="${txHash ? 'padding-top: 16px;' : ''}">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Date & Time
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px;">
                  ${formattedDate} at ${formattedTime}
                </p>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>

    <!-- Help Text -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="text-align: center;">
          <p style="margin: 0; color: #6b6b7a; font-size: 13px;">
            Your funds have not been deducted. Please try again or contact support if the issue persists.
          </p>
        </td>
      </tr>
    </table>
  `;

  return baseTemplate({
    preheader: `Swap failed: ${fromAmount} ${fromToken} → ${toToken}`,
    content,
  });
};
