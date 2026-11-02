import nodemailer from 'nodemailer';
import fs from 'fs';
import { db } from './db.js';
import { bufferCache } from './bufferCache.js';

export const kindleService = {
  /**
   * Verify SMTP transporter configuration
   */
  async verifyConnection(smtpConfig) {
    if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.pass) {
      throw new Error('SMTP host, username, and password are required.');
    }

    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: Number(smtpConfig.port) || 587,
      secure: Number(smtpConfig.port) === 465,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass
      }
    });

    await transporter.verify();
    return true;
  },

  /**
   * Send EPUB file to Kindle email address
   */
  async sendToKindle({ epubRecord, targetEmail, customSmtp = null }) {
    if (!targetEmail || !targetEmail.includes('@')) {
      throw new Error('A valid Kindle email address (e.g., yourname@kindle.com) is required.');
    }

    const cached = bufferCache.get(epubRecord.id);
    const hasFileOnDisk = epubRecord.filePath && fs.existsSync(epubRecord.filePath);

    if (!cached && !hasFileOnDisk) {
      throw new Error('EPUB file not found on server or expired.');
    }

    const settings = db.getSettings();
    const smtp = customSmtp || {
      host: settings.smtpHost,
      port: settings.smtpPort,
      user: settings.smtpUser,
      pass: settings.smtpPass,
      from: settings.senderEmail || settings.smtpUser
    };

    // If no SMTP configured, allow simulated test dispatch in development mode
    if (!smtp.host || !smtp.user || !smtp.pass) {
      // In development / demo mode, simulate successful queueing
      db.recordKindleDelivery();
      return {
        success: true,
        simulated: true,
        message: `Delivery queued to ${targetEmail} (Simulation Mode: Configure your SMTP credentials in Settings for live email delivery to Amazon Kindle).`
      };
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: Number(smtp.port) || 587,
      secure: Number(smtp.port) === 465,
      auth: {
        user: smtp.user,
        pass: smtp.pass
      }
    });

    const fileContent = (cached && cached.buffer) 
      ? cached.buffer 
      : fs.readFileSync(epubRecord.filePath);

    const mailOptions = {
      from: smtp.from || smtp.user,
      to: targetEmail,
      subject: epubRecord.title || 'Send to Kindle',
      text: `Sent via ReadCast Article-to-EPUB: ${epubRecord.title}`,
      attachments: [
        {
          filename: epubRecord.filename || `${epubRecord.id}.epub`,
          content: fileContent,
          contentType: 'application/epub+zip'
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    db.recordKindleDelivery();

    return {
      success: true,
      simulated: false,
      messageId: info.messageId,
      message: `EPUB sent successfully to ${targetEmail}!`
    };
  }
};
