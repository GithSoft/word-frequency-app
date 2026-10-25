const express = require('express');
const router = express.Router();
const { User } = require('../models');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'default-dev-secret';
const nodemailer = require('nodemailer');

// Configure Email Transporter
const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Login: Generate OTP
router.post('/login', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    try {
        let user = await User.findOne({ where: { email } });
        if (!user) {
            user = await User.create({ email });
        }

        // Generate 6 digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        user.otp = otp;
        user.otpExpires = otpExpires;
        await user.save();

        // Send Email if configured
        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Your Login Code - Word Frequency App',
                text: `Your OTP code is: ${otp}. It expires in 10 minutes.`
            });
            console.log(`📧 Email sent to ${email}`);
            res.json({ message: 'OTP sent to email' });
        } else {
            // Local development mode fallback (only when explicitly non-production)
            if (process.env.NODE_ENV !== 'production') {
                console.log(`==========================================`);
                console.log(`🔑 OTP for ${email}: ${otp}`);
                console.log(`==========================================`);
                res.json({ message: 'OTP sent to email (Dev Mode)', devMode: otp });
            } else {
                console.warn(`[Auth] SMTP credentials missing in production for ${email}`);
                res.status(503).json({ error: 'Dịch vụ gửi mã qua email hiện chưa được cấu hình trên máy chủ.' });
            }
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Verify OTP
router.post('/verify', async (req, res) => {
    const { email, otp } = req.body;

    try {
        const user = await User.findOne({ where: { email } });
        if (!user || user.otp !== otp || new Date() > user.otpExpires) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        // Clear OTP
        user.otp = null;
        user.otpExpires = null;
        await user.save();

        // Issue Token
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

        res.json({ token, user: { id: user.id, email: user.email } });
    } catch (error) {
        res.status(500).json({ error: 'Verification failed' });
    }
});

module.exports = router;
