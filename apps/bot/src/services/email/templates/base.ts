/**
 * Base Email Template
 *
 * Provides the common HTML structure for all CC Bot email notifications.
 */

export interface BaseTemplateProps {
  preheader?: string;
  content: string;
}

export const baseTemplate = ({ preheader = '', content }: BaseTemplateProps): string => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>CC Bot Wallet</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    /* Reset */
    body, table, td, p, a, li, blockquote {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    img {
      -ms-interpolation-mode: bicubic;
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
    }
    body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background-color: #0a0a0f;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
    }
    .preheader {
      display: none;
      max-width: 0;
      max-height: 0;
      overflow: hidden;
      font-size: 1px;
      line-height: 1px;
      color: #0a0a0f;
      opacity: 0;
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f;">
  <!-- Preheader text (preview text in email clients) -->
  <div class="preheader">${preheader}</div>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #0a0a0f;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px;">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="background: linear-gradient(135deg, #875CFF 0%, #D5A5E3 100%); border-radius: 16px; padding: 16px 24px;">
                    <span style="color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">CC Bot</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Card -->
          <tr>
            <td style="background-color: #12121a; border-radius: 24px; padding: 40px 32px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 32px;">
              <p style="margin: 0 0 16px 0; color: #6b6b7a; font-size: 13px; line-height: 20px;">
                You're receiving this email because you have an account with CC Bot Wallet.
              </p>
              <p style="margin: 0 0 16px 0; color: #6b6b7a; font-size: 13px; line-height: 20px;">
                <a href="#" style="color: #875CFF; text-decoration: none;">Manage notification preferences</a>
              </p>
              <p style="margin: 0; color: #4a4a5a; font-size: 12px;">
                &copy; ${new Date().getFullYear()} CC Bot Wallet. Built on Canton Network.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
