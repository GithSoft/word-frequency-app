const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { Feedback, User } = require('../models');
const authenticateToken = require('../middleware/auth');

// Multer memory storage (Zero local disk clutter)
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname || mimetype) {
            return cb(null, true);
        } else {
            return cb(new Error('Chỉ chấp nhận tệp hình ảnh, video hoặc tài liệu hợp lệ'));
        }
    }
});

// In-memory sliding-window IP rate limiting (Max 3 submissions per IP per 60 seconds)
const ipRateLimit = new Map();
const cleanupInterval = 5 * 60 * 1000;
setInterval(() => {
    const threshold = Date.now() - 60000;
    for (const [ip, timestamps] of ipRateLimit.entries()) {
        const valid = timestamps.filter(t => t > threshold);
        if (valid.length === 0) {
            ipRateLimit.delete(ip);
        } else {
            ipRateLimit.set(ip, valid);
        }
    }
}, cleanupInterval).unref();

// Type metadata mapping
const typeMap = {
    bug: { label: '🐞 Bug Report', tag: 'bug' },
    feature: { label: '💡 Feature Request', tag: 'enhancement' },
    general: { label: '💬 General Feedback', tag: 'user-feedback' }
};

// POST /api/feedback - Product Feedback to GitHub Issue Gateway
router.post('/', upload.array('media', 5), async (req, res) => {
    try {
        const { content, type, email, hp_website } = req.body;

        // 1. Honeypot check for spam bots
        if (hp_website) {
            return res.json({ success: true, message: 'Feedback received' });
        }

        // 2. Client IP & Rate limiting
        const clientIp = req.headers['cf-connecting-ip'] ||
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.socket.remoteAddress ||
            '127.0.0.1';

        const now = Date.now();
        const timestamps = (ipRateLimit.get(clientIp) || []).filter(t => now - t < 60000);
        if (timestamps.length >= 3) {
            return res.status(429).json({ error: 'Bạn gửi góp ý quá nhanh. Vui lòng đợi 1 phút trước khi tiếp tục.' });
        }
        timestamps.push(now);
        ipRateLimit.set(clientIp, timestamps);

        const textContent = (content || '').trim();
        const files = req.files || [];

        if (!textContent && files.length === 0) {
            return res.status(400).json({ error: 'Vui lòng nhập nội dung góp ý hoặc đính kèm ảnh chụp màn hình.' });
        }

        const selectedType = (type && typeMap[type]) ? type : 'general';
        const typeMeta = typeMap[selectedType];

        let clientInfo = {};
        try {
            if (req.body.client_info) {
                clientInfo = typeof req.body.client_info === 'string'
                    ? JSON.parse(req.body.client_info)
                    : req.body.client_info;
            }
        } catch (_) {}

        const token = process.env.GITHUB_TOKEN;
        const repoId = process.env.GITHUB_REPO_ID || '1139152631';
        const repoOwner = process.env.GITHUB_REPO_OWNER || 'GithSoft';
        const repoName = process.env.GITHUB_REPO_NAME || 'word-frequency-app';

        // 3. Upload Attachments directly to GitHub User-Attachments CDN (0 commit, 0 local disk)
        const uploadedAttachments = [];
        if (files.length > 0 && token) {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                    const rawExt = path.extname(file.originalname).toLowerCase().replace('.', '') || 'jpg';
                    const safeExt = rawExt.replace(/[^a-z0-9]/g, '').substring(0, 5) || 'jpg';
                    const fileName = file.originalname || `attachment-${Date.now()}-${i + 1}.${safeExt}`;
                    const mimeType = file.mimetype || (safeExt === 'png' ? 'image/png' : 'image/jpeg');

                    const uploadUrl = `https://uploads.github.com/user-attachments/assets?name=${encodeURIComponent(fileName)}&content_type=${encodeURIComponent(mimeType)}&repository_id=${repoId}`;

                    const ghUploadRes = await fetch(uploadUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/json',
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'User-Agent': 'WordFrequency-Feedback-Bot'
                        },
                        body: file.buffer
                    });

                    if (ghUploadRes.ok) {
                        const ghUploadData = await ghUploadRes.json();
                        if (ghUploadData.url) {
                            const isImg = (mimeType && mimeType.startsWith('image/')) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(fileName);
                            uploadedAttachments.push({
                                name: fileName,
                                url: ghUploadData.url,
                                isImg
                            });
                        }
                    } else {
                        const uploadErr = await ghUploadRes.text();
                        console.warn('[Feedback] Direct user-asset upload warning:', ghUploadRes.status, uploadErr);
                    }
                } catch (attErr) {
                    console.warn('[Feedback] Attachment upload error:', attErr.message);
                }
            }
        }

        // 4. Compose Issue Markdown & Title
        const preview = textContent.length > 60
            ? textContent.substring(0, 60).trim() + '...'
            : textContent;
        const issueTitle = `[${typeMeta.label}] ${preview || (selectedType === 'bug' ? 'Báo lỗi nhanh từ người dùng' : 'Góp ý từ người dùng')}`;

        let issueBody = `## ${typeMeta.label}

### 📝 User Feedback / Description
${textContent || '_(Người dùng không nhập mô tả chi tiết; thông tin được gửi kèm qua ảnh chụp màn hình / thông số chẩn đoán thiết bị bên dưới)_'}

---

### 👤 Contact Information
- **Contact / Email:** \`${email || 'Anonymous (Không để lại liên hệ)'}\`
- **Submission Time:** \`${new Date().toISOString()}\`
- **Origin:** \`${req.headers.origin || 'https://words.githsoft.com'}\`

---

### 📱 Client Diagnostics
- **User Agent:** \`${clientInfo.ua || req.headers['user-agent'] || 'Unknown'}\`
- **Screen Resolution:** \`${clientInfo.screen || 'Unknown'}\`
- **Language:** \`${clientInfo.lang || req.headers['accept-language'] || 'Unknown'}\`
- **Page URL:** \`${clientInfo.page || req.headers.referer || 'https://words.githsoft.com'}\`
- **Timezone:** \`${clientInfo.timezone || 'Unknown'}\`
`;

        if (uploadedAttachments.length > 0) {
            issueBody += `
---

### 📎 Đính Kèm / Attachments (${uploadedAttachments.length} tệp)
${uploadedAttachments.map((att, idx) => {
    const imgSrc = att.url.includes('user-attachments') ? att.url : `${att.url}?raw=true`;
    return `- 📁 **Tệp ${idx + 1}:** [${att.name}](${att.url})${att.isImg ? `\n\n<a href="${att.url}"><img src="${imgSrc}" alt="${att.name}" width="480" /></a>` : ''}`;
}).join('\n\n')}
`;
        }

        issueBody += `
---
*Created automatically by WordFrequency Feedback Gateway (Zero-Storage Pattern)*
`;

        // 5. Create GitHub Issue
        let issueUrl = null;
        let issueNumber = null;
        if (token) {
            try {
                const labels = Array.from(new Set(['user-feedback', typeMeta.tag]));
                const ghRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/issues`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/vnd.github+json',
                        'User-Agent': 'WordFrequency-Feedback-Bot',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        title: issueTitle,
                        body: issueBody,
                        labels
                    })
                });

                if (ghRes.ok) {
                    const ghData = await ghRes.json();
                    issueUrl = ghData.html_url;
                    issueNumber = ghData.number;
                } else {
                    const ghErrText = await ghRes.text();
                    console.warn('[Feedback] GitHub issue creation failed:', ghRes.status, ghErrText);
                }
            } catch (ghErr) {
                console.warn('[Feedback] GitHub issue request error:', ghErr.message);
            }
        }

        // 6. DB Logging for audit and compatibility with admin.html
        try {
            await Feedback.create({
                content: textContent || 'Attached files only',
                type: selectedType,
                email: email || null,
                issue_url: issueUrl,
                media: uploadedAttachments.length > 0 ? JSON.stringify(uploadedAttachments.map(a => a.url)) : null
            });
        } catch (dbErr) {
            console.warn('[Feedback] DB audit logging warning:', dbErr.message);
        }

        res.json({
            success: true,
            message: 'Feedback received',
            issue_url: issueUrl,
            issue_number: issueNumber
        });
    } catch (err) {
        console.error('[Feedback] Handler error:', err);
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

// GET /api/feedback - Preserved for Admin Portal compatibility
router.get('/', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.email !== 'admin@example.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const feedbacks = await Feedback.findAll({
            order: [['createdAt', 'DESC']],
            include: [User]
        });
        res.json(feedbacks);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch feedback' });
    }
});

module.exports = router;
