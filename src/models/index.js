const User = require('./User');
const SavedWord = require('./SavedWord');
const Feedback = require('./Feedback');
const sequelize = require('../db');

User.hasMany(SavedWord, { onDelete: 'CASCADE' });
SavedWord.belongsTo(User);

Feedback.belongsTo(User); // Optional association if logged in

// Sync DB & auto-migrate new columns if missing in SQLite
sequelize.sync().then(async () => {
    try {
        const [columns] = await sequelize.query("PRAGMA table_info(SavedWords);");
        const colNames = new Set(columns.map(c => c.name));
        if (!colNames.has('type')) {
            await sequelize.query("ALTER TABLE SavedWords ADD COLUMN type VARCHAR(50) DEFAULT 'word';");
        }
        if (!colNames.has('meaning')) {
            await sequelize.query("ALTER TABLE SavedWords ADD COLUMN meaning TEXT;");
        }
        if (!colNames.has('context')) {
            await sequelize.query("ALTER TABLE SavedWords ADD COLUMN context TEXT;");
        }
        if (!colNames.has('notes')) {
            await sequelize.query("ALTER TABLE SavedWords ADD COLUMN notes TEXT;");
        }

        // Auto-migrate Feedbacks columns if missing
        const [fbColumns] = await sequelize.query("PRAGMA table_info(Feedbacks);");
        const fbColNames = new Set(fbColumns.map(c => c.name));
        if (!fbColNames.has('issue_url')) {
            await sequelize.query("ALTER TABLE Feedbacks ADD COLUMN issue_url VARCHAR(255);");
        }
        if (!fbColNames.has('media')) {
            await sequelize.query("ALTER TABLE Feedbacks ADD COLUMN media TEXT;");
        }
    } catch (e) {
        console.warn('[DB Migration] Notice on column sync:', e.message);
    }
});

module.exports = {
    User,
    SavedWord,
    Feedback,
    sequelize
};
