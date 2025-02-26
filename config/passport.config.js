const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { WP_USER_REGISTRATION } = require('../models');
const bcrypt = require('bcryptjs');
const { getTokenAsTaxPayer } = require('../services/token.service');
const authConfig = require('./auth.config');

// Passport Configuration
passport.use(new LocalStrategy({
    usernameField: authConfig.passport.usernameField,
    passwordField: authConfig.passport.passwordField,
    passReqToCallback: true
  },
  async (req, username, password, done) => {
    try {
      // Find user
      const user = await WP_USER_REGISTRATION.findOne({
        where: { 
          Username: username,
          ValidStatus: '1'
        }   
      });

      if (!user) {
        return done(null, false, { message: 'Invalid credentials' });
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.Password);
      if (!isValid) {
        return done(null, false, { message: 'Invalid credentials' });
      }

      // Get LHDN token
      try {
        const accessToken = await getTokenAsTaxPayer(req, parseInt(user.ID, 10));
        user.accessToken = accessToken;
        console.log('accessToken', accessToken);
      } catch (tokenError) {
        console.error('Token generation error:', tokenError);
        return done(tokenError);
      }

      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }
));

// Serialize user for the session
passport.serializeUser((user, done) => {
  done(null, user.ID);
});

// Deserialize user from the session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await WP_USER_REGISTRATION.findOne({
      where: { 
        ID: id,
        ValidStatus: '1'
      },
      attributes: authConfig.passport.sessionFields
    });
    done(null, user);
  } catch (error) {
    done(error);
  }
});

module.exports = passport; 