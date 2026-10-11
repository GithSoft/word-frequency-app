const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const SavedWord = sequelize.define('SavedWord', {
    word: {
        type: DataTypes.STRING,
        allowNull: false
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
