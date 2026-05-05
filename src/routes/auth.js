const bcrypt = require('bcryptjs');
const express = require('express');

const logger = require('../logger');
const {authRateLimit} = require('../middleware/rateLimit');
const {requestLogContext} = require('../middleware/requestLogging');
const {
  createProfile,
  getAuthUserByEmail,
  getProfileById,
} = require('../store');

const router = express.Router();

function assertRequired(value, label) {
  if (!String(value || '').trim()) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }
}

function validatePasswordFormat(password) {
  const value = String(password || '');

  if (value.length < 8) {
    const error = new Error('Password must be at least 8 characters long.');
    error.status = 400;
    throw error;
  }
}

function createUserSession(request, profile) {
  request.session.userId = profile.id;
  request.session.userRole = profile.role;
}

router.get('/me', async (request, response) => {
  response.json({profile: request.currentUser});
});

router.post('/signup', authRateLimit, async (request, response, next) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      defaultCar,
      defaultOffice,
      defaultStartingLocation,
    } = request.body;

    assertRequired(name, 'Name');
    assertRequired(email, 'Email');
    assertRequired(password, 'Password');
    assertRequired(phone, 'Phone number');
    validatePasswordFormat(password);

    const passwordHash = await bcrypt.hash(String(password), 12);
    const profile = await createProfile({
      name,
      email,
      passwordHash,
      phone,
      defaultCar,
      defaultOffice,
      defaultStartingLocation,
    });

    createUserSession(request, profile);
    logger.info('auth.signup.success', {
      ...requestLogContext(request),
      profileId: profile.id,
      email: profile.email,
      role: profile.role,
    });
    response.status(201).json({profile});
  } catch (error) {
    logger.warn('auth.signup.failed', {
      ...requestLogContext(request),
      email: request.body?.email,
      error: logger.serializeError(error),
    });
    next(error);
  }
});

router.post('/login', authRateLimit, async (request, response, next) => {
  try {
    const {email, password} = request.body;

    assertRequired(email, 'Email');
    assertRequired(password, 'Password');

    const user = await getAuthUserByEmail(email);

    if (!user) {
      logger.warn('auth.login.failed_unknown_email', {
        ...requestLogContext(request),
        email,
      });
      const error = new Error('Invalid email or password.');
      error.status = 401;
      throw error;
    }

    const isValidPassword =
        await bcrypt.compare(String(password), user.passwordHash);

    if (!isValidPassword) {
      logger.warn('auth.login.failed_bad_password', {
        ...requestLogContext(request),
        email,
        profileId: user.id,
      });
      const error = new Error('Invalid email or password.');
      error.status = 401;
      throw error;
    }

    const profile = await getProfileById(user.id);
    createUserSession(request, profile);
    logger.info('auth.login.success', {
      ...requestLogContext(request),
      profileId: profile.id,
      email: profile.email,
      role: profile.role,
    });
    response.json({profile});
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (request, response, next) => {
  const logContext = {
    ...requestLogContext(request),
  };

  request.session.destroy((error) => {
    if (error) {
      logger.error('auth.logout.failed', {
        ...logContext,
        error: logger.serializeError(error),
      });
      next(error);
      return;
    }

    logger.info('auth.logout.success', logContext);
    response.json({ok: true});
  });
});

module.exports = router;
