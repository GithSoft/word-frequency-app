const { DataTypes } = require('sequelize');
const sequelize = require('../db');

const Feedback = sequelize.define('Feedback', {
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    type: {
        type: DataTypes.STRING,
        defaultValue: 'general' // bug, feature, general
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true
    },
    issue_url: {
        type: DataTypes.STRING,
        allowNull: true
    },
    media: {
        type: DataTypes.TEXT,
        allowNull: true
    }
});

module.exports = Feedback;
