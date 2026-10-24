const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const SavedWord = sequelize.define('SavedWord', {
    word: {
        type: DataTypes.STRING,
        allowNull: false
    },
    type: {
        type: DataTypes.STRING, // 'word' | 'phrase'
        defaultValue: 'word'
    },
    meaning: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    context: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    srsInterval: {
        type: DataTypes.INTEGER,
        defaultValue: 0 // in minutes
    },
    nextReview: {
        type: DataTypes.DATE,
        allowNull: true
    },
    streak: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['UserId', 'word']
        }
    ]
});

module.exports = SavedWord;
