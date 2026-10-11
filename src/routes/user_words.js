const express = require('express');
const router = express.Router();
const { SavedWord, sequelize } = require('../models');
const authenticateToken = require('../middleware/auth');

// Get all saved words for user
router.get('/words', authenticateToken, async (req, res) => {
    try {
        const words = await SavedWord.findAll({ where: { UserId: req.user.id } });
        res.json(words);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch words' });
    }
});

// Sync (Upsert) words
// Body: { words: [{ word, srsInterval, nextReview, streak }] }
router.post('/words/sync', authenticateToken, async (req, res) => {
    const { words } = req.body;
    if (!Array.isArray(words)) return res.status(400).json({ error: 'Invalid data' });

    try {
        const results = await sequelize.transaction(async (t) => {
            const synced = [];
            for (const w of words) {
                const [record, created] = await SavedWord.findOrCreate({
                    where: { UserId: req.user.id, word: w.word },
                    defaults: {
                        srsInterval: w.srsInterval || 0,
                        nextReview: w.nextReview || null,
                        streak: w.streak || 0
                    },
                    transaction: t
                });

                if (!created) {
                    // Update if exists
                    if (w.srsInterval !== undefined) record.srsInterval = w.srsInterval;
                    if (w.nextReview !== undefined) record.nextReview = w.nextReview;
                    if (w.streak !== undefined) record.streak = w.streak;
                    await record.save({ transaction: t });
                }
                synced.push(record);
            }
            return synced;
        });
        res.json({ success: true, count: results.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Sync failed' });
    }
});

// Delete word
router.delete('/words/:word', authenticateToken, async (req, res) => {
    try {
        await SavedWord.destroy({
            where: { UserId: req.user.id, word: req.params.word }
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Delete failed' });
    }
});

module.exports = router;
