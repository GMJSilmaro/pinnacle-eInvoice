const express = require('express');
const router = express.Router();
const { WP_LOGS } = require('../../models');
const { Op } = require('sequelize');
const { isAuthenticated } = require('../../middleware/auth');

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
            CreateTS: new Date().toISOString(),
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

/**
 * @route GET /api/logs/recent
 * @desc Get recent logs for dashboard display
 * @access Private
 */
router.get('/recent', isAuthenticated, async (req, res) => {
  try {
    // Get the most recent 10 logs
    const logs = await WP_LOGS.findAll({
      order: [['CreateTS', 'DESC']],
      limit: 10
    });
    
    res.json(logs);
  } catch (error) {
    console.error('Error fetching recent logs:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route GET /api/logs
 * @desc Get logs with pagination and filtering
 * @access Private
 */
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      type, 
      module,
      startDate,
      endDate,
      search
    } = req.query;
    
    // Calculate offset
    const offset = (page - 1) * limit;
    
    // Build where clause
    const whereClause = {};
    
    if (type) {
      whereClause.LogType = type;
    }
    
    if (module) {
      whereClause.Module = module;
    }
    
    // Date range filter
    if (startDate || endDate) {
      whereClause.CreateTS = {};
      
      if (startDate) {
        whereClause.CreateTS[Op.gte] = new Date(startDate);
      }
      
      if (endDate) {
        whereClause.CreateTS[Op.lte] = new Date(endDate);
      }
    }
    
    // Search filter
    if (search) {
      whereClause[Op.or] = [
        { Description: { [Op.like]: `%${search}%` } },
        { LoggedUser: { [Op.like]: `%${search}%` } },
        { Action: { [Op.like]: `%${search}%` } }
      ];
    }
    
    // Get logs with pagination
    const { count, rows: logs } = await WP_LOGS.findAndCountAll({
      where: whereClause,
      order: [['CreateTS', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    // Calculate total pages
    const totalPages = Math.ceil(count / limit);
    
    res.json({
      logs,
      pagination: {
        total: count,
        totalPages,
        currentPage: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router; 