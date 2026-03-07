/**
 * Transaction Email Templates
 *
 * Email templates for send and receive transaction notifications.
 */

import { baseTemplate } from './base.js';

export interface TransactionSentProps {
  recipientName?: string;
  amount: string;
  token: string;
  recipientAddress: string;
  txHash: string;
  timestamp: Date;
  fee?: string;
  explorerUrl?: string;
}

export interface TransactionReceivedProps {
  senderName?: string;
  amount: string;
  token: string;
  senderAddress: string;
  txHash: string;
  timestamp: Date;
  newBalance?: string;
  explorerUrl?: string;
}

/**
 * Email template for outgoing transactions (sent)
 */
export const transactionSentTemplate = (props: TransactionSentProps): string => {
  const {
    recipientName,
    amount,
    token,
    recipientAddress,
    txHash,
    timestamp,
    fee,
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

  const truncatedAddress = `${recipientAddress.slice(0, 12)}...${recipientAddress.slice(-8)}`;
  const truncatedTxHash = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;

  const content = `
    <!-- Icon -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <div style="width: 64px; height: 64px; background-color: rgba(239, 68, 68, 0.2); border-radius: 16px; display: inline-block; line-height: 64px; text-align: center;">
            <span style="font-size: 28px;">↑</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Title -->
    <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
      Transaction Sent
    </h1>
    <p style="margin: 0 0 32px 0; color: #6b6b7a; font-size: 15px; text-align: center;">
      Your ${token} transfer has been confirmed
    </p>

    <!-- Amount Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 16px; padding: 24px; text-align: center;">
          <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">
            Amount Sent
          </p>
          <p style="margin: 0; color: #ef4444; font-size: 36px; font-weight: 700;">
            -${amount} ${token}
          </p>
          ${fee ? `<p style="margin: 8px 0 0 0; color: #6b6b7a; font-size: 13px;">Fee: ${fee} ${token}</p>` : ''}
        </td>
      </tr>
    </table>

    <!-- Transaction Details -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="background-color: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px;">

          <!-- Recipient -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding-bottom: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Recipient
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px; font-weight: 500;">
                  ${recipientName || truncatedAddress}
                </p>
                ${recipientName ? `<p style="margin: 4px 0 0 0; color: #6b6b7a; font-size: 12px; font-family: monospace;">${truncatedAddress}</p>` : ''}
              </td>
            </tr>
          </table>

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
    preheader: `You sent ${amount} ${token} to ${recipientName || truncatedAddress}`,
    content,
  });
};

/**
 * Email template for incoming transactions (received)
 */
export const transactionReceivedTemplate = (props: TransactionReceivedProps): string => {
  const {
    senderName,
    amount,
    token,
    senderAddress,
    txHash,
    timestamp,
    newBalance,
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

  const truncatedAddress = `${senderAddress.slice(0, 12)}...${senderAddress.slice(-8)}`;
  const truncatedTxHash = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;

  const content = `
    <!-- Icon -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <div style="width: 64px; height: 64px; background-color: rgba(34, 197, 94, 0.2); border-radius: 16px; display: inline-block; line-height: 64px; text-align: center;">
            <span style="font-size: 28px;">↓</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Title -->
    <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
      ${token} Received
    </h1>
    <p style="margin: 0 0 32px 0; color: #6b6b7a; font-size: 15px; text-align: center;">
      You've received a new transfer
    </p>

    <!-- Amount Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 16px; padding: 24px; text-align: center;">
          <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">
            Amount Received
          </p>
          <p style="margin: 0; color: #22c55e; font-size: 36px; font-weight: 700;">
            +${amount} ${token}
          </p>
          ${newBalance ? `<p style="margin: 8px 0 0 0; color: #6b6b7a; font-size: 13px;">New Balance: ${newBalance} ${token}</p>` : ''}
        </td>
      </tr>
    </table>

    <!-- Transaction Details -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="background-color: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px;">

          <!-- Sender -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding-bottom: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  From
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px; font-weight: 500;">
                  ${senderName || truncatedAddress}
                </p>
                ${senderName ? `<p style="margin: 4px 0 0 0; color: #6b6b7a; font-size: 12px; font-family: monospace;">${truncatedAddress}</p>` : ''}
              </td>
            </tr>
          </table>

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
    preheader: `You received ${amount} ${token} from ${senderName || truncatedAddress}`,
    content,
  });
};
