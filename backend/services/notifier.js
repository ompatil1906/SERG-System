const twilio = require('twilio');
const nodemailer = require('nodemailer');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

let twilioClient = null;
if (accountSid && accountSid.startsWith('AC') && authToken && twilioNumber) {
    twilioClient = twilio(accountSid, authToken);
} else {
    console.warn('Twilio credentials not fully set or are placeholders. SMS will be disabled.');
}

let transporter = null;
if (process.env.SMTP_USER && !process.env.SMTP_USER.includes('your-email') && process.env.SMTP_PASS && process.env.SMTP_PASS !== 'your-email-password') {
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || 587,
        secure: false, // true for 465, false for other ports
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
} else {
    console.warn('SMTP credentials not fully set or are placeholders. Email will be mocked.');
}

async function sendSMS(to, message) {
    if (!twilioClient) {
        console.log(`[SMS MOCK] To: ${to} | Message: ${message}`);
        return;
    }
    try {
        const info = await twilioClient.messages.create({
            body: message,
            from: twilioNumber,
            to: to
        });
        console.log('SMS Sent:', info.sid);
    } catch (error) {
        console.error('Failed to send SMS:', error);
    }
}

async function sendEmail(to, subject, body) {
    if (!transporter) {
        console.log(`[EMAIL MOCK] To: ${to} | Subject: ${subject} | Body: ${body}`);
        return;
    }
    try {
        const info = await transporter.sendMail({
            from: `"SERG System" <${process.env.SMTP_USER}>`,
            to: to,
            subject: subject,
            text: body,
        });
        console.log('Email Sent:', info.messageId);
    } catch (error) {
        console.error('Failed to send Email:', error);
    }
}

async function triggerEmergencyNotifications(deviceData, analysisResult, contacts) {
    const mapLink = `https://maps.google.com/?q=${deviceData.latitude},${deviceData.longitude}`;

    const msgBody = `🚨 Accident detected!\n` +
        `Vehicle: ${deviceData.device_id}\n` +
        `Severity: ${analysisResult.severity}\n` +
        `Location: ${mapLink}\n` +
        `Time: ${new Date().toLocaleString()}`;

    const promises = [];

    for (const contact of contacts) {
        if (contact.phone) {
            promises.push(sendSMS(contact.phone, msgBody));
        }
        if (contact.email) {
            promises.push(sendEmail(contact.email, '🚨 SERG Emergency Alert', msgBody));
        }
    }

    await Promise.all(promises);
}

module.exports = { triggerEmergencyNotifications };
