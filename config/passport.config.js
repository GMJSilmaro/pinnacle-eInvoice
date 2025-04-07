const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { WP_USER_REGISTRATION, WP_LOGS, sequelize } = require('../models');
const bcrypt = require('bcryptjs');
const { getTokenAsTaxPayer } = require('../services/token.service');
const authConfig = require('./auth.config');
const { LOG_TYPES, MODULES, ACTIONS, STATUS } = require('../services/logging.service');

// Passport Configuration
passport.use(new LocalStrategy({
    usernameField: authConfig.passport.usernameField,
    passwordField: authConfig.passport.passwordField,
    passReqToCallback: true
  },
  async (req, username, password, done) => {
    try {
      console.log(`Authentication attempt for user: ${username}`);
      
      // Find user - allow login with username or email
      const user = await WP_USER_REGISTRATION.findOne({
        where: {
          [sequelize.Sequelize.Op.or]: [
            { Username: username },
            { Email: username }
          ],
          ValidStatus: '1'
        }
      });

      if (!user) {
        console.log(`User not found: ${username}`);
        return done(null, false, { message: 'Invalid credentials' });
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.Password);
      if (!isValid) {
        console.log(`Invalid password for user: ${username}`);
        return done(null, false, { message: 'Invalid credentials' });
      }

      console.log(`Authentication successful for user: ${username}`);
      
      // Update last login time
      await WP_USER_REGISTRATION.update(
        { LastLoginTime: sequelize.literal("CONVERT(datetime, GETDATE(), 120)") },
        { where: { ID: user.ID } }
      );
      
      // Log successful login
      try {
        await WP_LOGS.create({
          Description: `User login: ${user.Username}`,
          CreateTS: sequelize.literal("CONVERT(datetime, GETDATE(), 120)"),
          LoggedUser: user.Username,
          IPAddress: req.ip || 'unknown',
          LogType: LOG_TYPES.INFO,
          Module: MODULES.SYSTEM,
          Action: ACTIONS.LOGIN,
          Status: STATUS.SUCCESS,
          UserID: user.ID
        });
      } catch (logError) {
        console.error('Error logging login:', logError);
      }

      // Get LHDN token if needed
      try {
        if (typeof getTokenAsTaxPayer === 'function') {
          const accessToken = await getTokenAsTaxPayer(req, parseInt(user.ID, 10));
          user.accessToken = accessToken;
          console.log('Access token generated successfully');
        }
      } catch (tokenError) {
        console.error('Token generation error:', tokenError);
        // Continue login even if token generation fails
      }

      return done(null, user);
    } catch (error) {
      console.error('Authentication error:', error);
      return done(error);
    }
  }
));

// Serialize user for the session
passport.serializeUser((user, done) => {
  try {
    console.log(`Serializing user: ${user.Username} (ID: ${user.ID})`);
    const sessionUser = {
      id: user.ID,
      username: user.Username,
      admin: user.Admin === 1,
      IDType: user.IDType,
      IDValue: user.IDValue,
      TIN: user.TIN,
      Email: user.Email,
      fullName: user.FullName,
      profilePicture: user.ProfilePicture,
      lastLoginTime: new Date(),
      isActive: true
    };
    done(null, sessionUser);
  } catch (error) {
    console.error('Error serializing user:', error);
    done(error);
  }
});

// Deserialize user from the session
passport.deserializeUser(async (sessionUser, done) => {
  try {
    if (!sessionUser || !sessionUser.id) {
      console.log('Invalid session user data');
      return done(null, false);
    }
    
    console.log(`Deserializing user ID: ${sessionUser.id}`);
    
    // Try to find the user
    const user = await WP_USER_REGISTRATION.findOne({
      where: { 
        ID: sessionUser.id,
        ValidStatus: '1'
      },
      attributes: authConfig.passport.sessionFields
    });
    
    if (!user) {
      console.log(`User not found for ID: ${sessionUser.id}`);
      return done(null, false);
    }
    
    // Merge session data with fresh user data
    const userData = {
      ...sessionUser,
      ...user.toJSON()
    };
    
    done(null, userData);
  } catch (error) {
    console.error('Error deserializing user:', error);
    done(error);
  }
});

module.exports = passport; 