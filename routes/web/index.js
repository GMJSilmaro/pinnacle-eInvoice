const express = require('express');
const router = express.Router();
const { auth } = require('../../middleware');
const { WP_USER_REGISTRATION, WP_LOGS, sequelize } = require('../../models');

// Session checking middleware
const checkSession = async (req, res, next) => {
    try {
        // If no user in session, redirect to login
        if (!req.session?.user) {
            return res.redirect('/login');
        }

        // Check if user exists in database
        const user = await WP_USER_REGISTRATION.findOne({
            where: { Username: req.session.user.username }
        });

        if (!user) {
            req.session.destroy();
            return res.redirect('/login?error=invalid-session');
        }

        // Update session timestamp
        req.session.lastActivity = Date.now();
        next();
    } catch (error) {
        console.error('Session check error:', error);
        return res.redirect('/login?error=server-error');
    }
};

// Auth routes
router.get('/login', (req, res) => {
    // If already logged in, redirect to dashboard
    if (req.session?.user) {
        return res.redirect('/');
    }
    res.render('auth/login.html', {
        title: 'Login',
        layout: false
    });
});

router.post('/auth/logout', async (req, res) => {
    try {
        // Log the logout action if user is in session
        if (req.session?.user) {
            await WP_LOGS.create({
                Description: `User ${req.session.user.username} logged out`,
                CreateTS: sequelize.literal('GETDATE()'),
                LoggedUser: req.session.user.username,
                Action: 'LOGOUT',
                IPAddress: req.ip
            });
        }
        // Destroy the session
        req.session.destroy(() => {
            res.redirect('/login');
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.redirect('/login');
    }
});

// GET route for logout to handle redirects from navbar.js
router.get('/auth/logout', async (req, res) => {
    try {
        // Log the logout action if user is in session
        if (req.session?.user) {
            await WP_LOGS.create({
                Description: `User ${req.session.user.username} logged out (${req.query.reason || 'manual'})`,
                CreateTS: sequelize.literal('GETDATE()'),
                LoggedUser: req.session.user.username,
                Action: 'LOGOUT',
                IPAddress: req.ip
            });
        }

        // Destroy the session
        req.session.destroy(() => {
            const redirectUrl = req.query.expired ?
                `/login?expired=true&reason=${req.query.reason || 'timeout'}` :
                '/login';
            res.redirect(redirectUrl);
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.redirect('/login');
    }
});

// Dashboard routes with session checking
router.get('/', checkSession, (req, res) => {
    res.render('dashboard/index.html', {
        title: 'Dashboard',
        user: req.session.user || null,
        layout: 'layout'
    });
});

router.get('/dashboard', checkSession, (req, res) => {
    res.render('dashboard/index.html', {
        title: 'Dashboard',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Inbound redirect
router.get('/inbound', checkSession, (req, res) => {
    res.render('dashboard/inbound.html', {
        title: 'Inbound',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Outbound redirect
router.get('/outbound', checkSession, (req, res) => {
    res.render('dashboard/outbound.html', {
        title: 'Outbound',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Consolidated redirect
router.get('/consolidated', checkSession, (req, res) => {
    res.render('dashboard/consolidated.html', {
        title: 'Outbound Consolidation',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Help & Support route
router.get('/help', checkSession, (req, res) => {
    res.render('dashboard/help.html', {
        title: 'Help & Support',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Changelog route
router.get('/changelog', checkSession, (req, res) => {
    res.render('dashboard/changelog.html', {
        title: 'Changelog',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Profile redirect
router.get('/profile', checkSession, (req, res) => {
    res.render('dashboard/profile.html', {
        title: 'Profile',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// User settings redirect for normal users
router.get('/settings/user/profile/:id', checkSession, auth.isAdmin, (req, res) => {
    res.render('dashboard/user-settings-page.html', {
        title: 'User Settings',
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Company profile route
router.get('/company/profile/:name', checkSession, auth.isAdmin, (req, res) => {
    res.render('dashboard/company-profile.html', {
        title: 'Company Profile',
        companyName: req.params.companyName,
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Admin settings route
router.get('/settings/user/admin/profile/:id', checkSession, auth.isAdmin, (req, res) => {
    res.render('dashboard/admin-settings.html', {
        title: 'User Management',
        id: req.session.user.id,
        user: req.session.user || null,
        layout: 'layout'
    });
});

// Users management route
router.get('/users', checkSession, auth.isAdmin, (req, res) => {
    res.render('dashboard/user-management.html', {
        title: 'Users Management',
        user: req.session.user || null,
        layout: 'layout'
    });
});

module.exports = router;
