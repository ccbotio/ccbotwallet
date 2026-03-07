/**
 * Security Alert Email Templates
 *
 * Email templates for security-related notifications.
 */

import { baseTemplate } from './base.js';

export interface NewLoginAlertProps {
  deviceType: string;
  browser?: string;
  ipAddress: string;
  location?: string;
  timestamp: Date;
  isNewDevice: boolean;
}

export interface SuspiciousActivityProps {
  activityType: 'failed_login' | 'unusual_transaction' | 'api_access' | 'settings_change';
  description: string;
  ipAddress?: string;
  location?: string;
  timestamp: Date;
  actionRequired: boolean;
}

export interface PasswordChangedProps {
  timestamp: Date;
  ipAddress?: string;
  wasYou: boolean;
}

export interface TwoFactorEnabledProps {
  method: 'passkey' | 'email' | 'telegram';
  timestamp: Date;
}

/**
 * Email template for new login alerts
 */
export const newLoginAlertTemplate = (props: NewLoginAlertProps): string => {
  const {
    deviceType,
    browser,
    ipAddress,
    location,
    timestamp,
    isNewDevice,
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
    timeZoneName: 'short',
  });

  const content = `
    <!-- Icon -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <div style="width: 64px; height: 64px; background-color: ${isNewDevice ? 'rgba(251, 191, 36, 0.2)' : 'rgba(34, 197, 94, 0.2)'}; border-radius: 16px; display: inline-block; line-height: 64px; text-align: center;">
            <span style="font-size: 28px;">${isNewDevice ? '🔔' : '✓'}</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Title -->
    <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
      ${isNewDevice ? 'New Device Login' : 'Login Detected'}
    </h1>
    <p style="margin: 0 0 32px 0; color: #6b6b7a; font-size: 15px; text-align: center;">
      ${isNewDevice ? 'A new device was used to access your wallet' : 'Your account was accessed'}
    </p>

    <!-- Details Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: rgba(255, 255, 255, 0.05); border-radius: 16px; padding: 24px;">

          <!-- Device -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding-bottom: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Device
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px; font-weight: 500;">
                  ${deviceType}${browser ? ` · ${browser}` : ''}
                </p>
              </td>
            </tr>
          </table>

          <!-- IP Address -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding: 16px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  IP Address
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px; font-family: monospace;">
                  ${ipAddress}
                </p>
              </td>
            </tr>
          </table>

          ${location ? `
          <!-- Location -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding: 16px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Approximate Location
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px;">
                  ${location}
                </p>
              </td>
            </tr>
          </table>
          ` : ''}

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

    ${isNewDevice ? `
    <!-- Warning -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="background-color: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.2); border-radius: 12px; padding: 16px;">
          <p style="margin: 0; color: #fbbf24; font-size: 14px; text-align: center;">
            If this wasn't you, please secure your account immediately.
          </p>
        </td>
      </tr>
    </table>

    <!-- Action Buttons -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td align="center">
          <a href="#" style="display: inline-block; background-color: #ef4444; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 12px; margin-right: 12px;">
            Not Me - Secure Account
          </a>
        </td>
      </tr>
    </table>
    ` : ''}
  `;

  return baseTemplate({
    preheader: isNewDevice
      ? `New device login detected from ${deviceType}`
      : `Login detected from ${deviceType}`,
    content,
  });
};

/**
 * Email template for suspicious activity alerts
 */
export const suspiciousActivityTemplate = (props: SuspiciousActivityProps): string => {
  const {
    activityType,
    description,
    ipAddress,
    location,
    timestamp,
    actionRequired,
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
    timeZoneName: 'short',
  });

  const activityLabels: Record<typeof activityType, string> = {
    failed_login: 'Multiple Failed Login Attempts',
    unusual_transaction: 'Unusual Transaction Pattern',
    api_access: 'API Access Detected',
    settings_change: 'Security Settings Changed',
  };

  const content = `
    <!-- Icon -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <div style="width: 64px; height: 64px; background-color: rgba(239, 68, 68, 0.2); border-radius: 16px; display: inline-block; line-height: 64px; text-align: center;">
            <span style="font-size: 28px;">⚠️</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Title -->
    <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
      Security Alert
    </h1>
    <p style="margin: 0 0 32px 0; color: #6b6b7a; font-size: 15px; text-align: center;">
      ${activityLabels[activityType]}
    </p>

    <!-- Alert Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 16px; padding: 24px;">
          <p style="margin: 0; color: #ffffff; font-size: 15px; line-height: 24px; text-align: center;">
            ${description}
          </p>
        </td>
      </tr>
    </table>

    <!-- Details -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="background-color: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px;">

          ${ipAddress ? `
          <!-- IP Address -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding-bottom: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  IP Address
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px; font-family: monospace;">
                  ${ipAddress}
                </p>
              </td>
            </tr>
          </table>
          ` : ''}

          ${location ? `
          <!-- Location -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding: 16px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Location
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px;">
                  ${location}
                </p>
              </td>
            </tr>
          </table>
          ` : ''}

          <!-- Date & Time -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="${ipAddress || location ? 'padding-top: 16px;' : ''}">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Detected At
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

    ${actionRequired ? `
    <!-- Action Required -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td align="center">
          <a href="#" style="display: inline-block; background-color: #ef4444; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 12px;">
            Secure My Account
          </a>
        </td>
      </tr>
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 16px;">
      <tr>
        <td style="text-align: center;">
          <p style="margin: 0; color: #6b6b7a; font-size: 13px;">
            If you recognize this activity, you can safely ignore this email.
          </p>
        </td>
      </tr>
    </table>
    ` : ''}
  `;

  return baseTemplate({
    preheader: `Security Alert: ${activityLabels[activityType]}`,
    content,
  });
};

/**
 * Email template for PIN/password changes
 */
export const pinChangedTemplate = (props: PasswordChangedProps): string => {
  const { timestamp, ipAddress, wasYou } = props;

  const formattedDate = timestamp.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const formattedTime = timestamp.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const content = `
    <!-- Icon -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <div style="width: 64px; height: 64px; background-color: rgba(135, 92, 255, 0.2); border-radius: 16px; display: inline-block; line-height: 64px; text-align: center;">
            <span style="font-size: 28px;">🔐</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Title -->
    <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
      PIN Changed
    </h1>
    <p style="margin: 0 0 32px 0; color: #6b6b7a; font-size: 15px; text-align: center;">
      Your wallet PIN has been successfully updated
    </p>

    <!-- Info Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: rgba(255, 255, 255, 0.05); border-radius: 16px; padding: 24px;">

          <!-- Date & Time -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="${ipAddress ? 'padding-bottom: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);' : ''}">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  Changed At
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px;">
                  ${formattedDate} at ${formattedTime}
                </p>
              </td>
            </tr>
          </table>

          ${ipAddress ? `
          <!-- IP Address -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding-top: 16px;">
                <p style="margin: 0 0 4px 0; color: #6b6b7a; font-size: 12px; text-transform: uppercase;">
                  IP Address
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 14px; font-family: monospace;">
                  ${ipAddress}
                </p>
              </td>
            </tr>
          </table>
          ` : ''}

        </td>
      </tr>
    </table>

    ${!wasYou ? `
    <!-- Warning -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 16px;">
          <p style="margin: 0; color: #ef4444; font-size: 14px; text-align: center;">
            If you didn't make this change, your account may be compromised.
          </p>
        </td>
      </tr>
    </table>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td align="center">
          <a href="#" style="display: inline-block; background-color: #ef4444; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 12px;">
            This Wasn't Me
          </a>
        </td>
      </tr>
    </table>
    ` : ''}
  `;

  return baseTemplate({
    preheader: 'Your CC Bot wallet PIN has been changed',
    content,
  });
};

/**
 * Email template for 2FA enabled
 */
export const twoFactorEnabledTemplate = (props: TwoFactorEnabledProps): string => {
  const { method, timestamp } = props;

  const formattedDate = timestamp.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const methodLabels: Record<typeof method, string> = {
    passkey: 'Passkey Authentication',
    email: 'Email Verification',
    telegram: 'Telegram Authentication',
  };

  const content = `
    <!-- Icon -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <div style="width: 64px; height: 64px; background-color: rgba(34, 197, 94, 0.2); border-radius: 16px; display: inline-block; line-height: 64px; text-align: center;">
            <span style="font-size: 28px;">✓</span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Title -->
    <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
      Security Enhanced
    </h1>
    <p style="margin: 0 0 32px 0; color: #6b6b7a; font-size: 15px; text-align: center;">
      ${methodLabels[method]} has been enabled
    </p>

    <!-- Success Card -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="background-color: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 16px; padding: 24px; text-align: center;">
          <p style="margin: 0 0 8px 0; color: #22c55e; font-size: 18px; font-weight: 600;">
            Your account is now more secure
          </p>
          <p style="margin: 0; color: #6b6b7a; font-size: 14px;">
            Enabled on ${formattedDate}
          </p>
        </td>
      </tr>
    </table>

    <!-- Info -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top: 24px;">
      <tr>
        <td style="text-align: center;">
          <p style="margin: 0; color: #6b6b7a; font-size: 13px; line-height: 20px;">
            With ${methodLabels[method].toLowerCase()} enabled, your wallet is protected by an additional layer of security.
          </p>
        </td>
      </tr>
    </table>
  `;

  return baseTemplate({
    preheader: `${methodLabels[method]} enabled for your CC Bot wallet`,
    content,
  });
};
