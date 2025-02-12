const express = require('express');
const router = express.Router();
const { WP_LOGS } = require('../../models');

// Create log entry
router.post('/', async (req, res) => {
    try {
        const {
            Description,
            LogType,
            Module,
            Action,
            Status
        } = req.body;

        // Get user info from session if available
        const LoggedUser = req.session?.user?.username || 'System';
        const UserID = req.session?.user?.id || null;
        const IPAddress = req.ip;

        const logEntry = await WP_LOGS.create({
            Description,
            LogType,
            Module,
            Action,
            Status,
            LoggedUser,
            UserID,
            IPAddress,
            CreateTS: sequelize.literal('GETDATE()')
        });

        res.json({
            success: true,
            data: logEntry
        });
    } catch (error) {
        console.error('Error creating log entry:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create log entry'
        });
    }
});

module.exports = router; 