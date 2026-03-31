require('dotenv').config();

const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const path = require('path');
const {
  applySecurityMiddleware,
  createSessionMiddleware,
  isProduction,
} = require('./config/security');
const logger = require('./logger');
const {createErrorHandler} = require('./middleware/errorHandler');
const {
  authRateLimit,
  ridePublishRateLimit,
} = require('./middleware/rateLimit');
const {
  requestLogContext,
  requestLoggingMiddleware,
} = require('./middleware/requestLogging');
const {
  cancelSeatRequest,
  createMessage,
  createProfile,
  createRide,
  createSeatRequest,
  getAuthUserByEmail,
  getProfileById,
  getProfiles,
  getRideById,
  listRides,
  updateProfile,
  updateSeatRequest,
} = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
applySecurityMiddleware(app);

app.use(createSessionMiddleware(session));

app.use(express.json());

app.use(requestLoggingMiddleware);

function assertRequired(value, label) {
  if (!String(value || '').trim()) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }
}

function parseDateTime(value, label) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    const error = new Error(`${label} is invalid.`);
    error.status = 400;
    throw error;
  }

  return parsed;
}

function floorToMinute(date) {
  const normalized = new Date(date);
  normalized.setSeconds(0, 0);
  return normalized;
}

function validateRideWindow(startWindowStart, startWindowEnd) {
  const start = parseDateTime(startWindowStart, 'Earliest departure');
  const end = parseDateTime(startWindowEnd, 'Latest departure');
  const now = floorToMinute(new Date());

  if (start.getTime() < now.getTime()) {
    const error = new Error('Earliest departure must be in the future.');
    error.status = 400;
    throw error;
  }

  if (end.getTime() <= start.getTime()) {
    const error =
        new Error('Latest departure must be later than earliest departure.');
    error.status = 400;
    throw error;
  }
}

async function requireAuth(request, response, next) {
  try {
    if (!request.session.userId) {
      logger.warn('auth.required', {
        ...requestLogContext(request),
      });
      response.status(401).json({error: 'Authentication required.'});
      return;
    }

    const profile = await getProfileById(request.session.userId);

    if (!profile) {
      logger.warn('auth.session_user_missing', {
        ...requestLogContext(request),
      });
      request.session.destroy(() => undefined);
      response.status(401).json({error: 'Authentication required.'});
      return;
    }

    request.currentUser = profile;
    next();
  } catch (error) {
    next(error);
  }
}

function requireManager(request, response, next) {
  if (!request.currentUser || request.currentUser.role !== 'MANAGER_USER') {
    logger.warn('auth.manager_required', {
      ...requestLogContext(request),
    });
    response.status(403).json({error: 'Forbidden'});
    return;
  }

  next();
}

function createUserSession(request, profile) {
  request.session.userId = profile.id;
  request.session.userRole = profile.role;
}

app.get('/debug.html', requireAuth, requireManager, (_request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, 'debug.html'));
});

app.use(express.static(PUBLIC_DIR));

app.get('/api/health', (_request, response) => {
  response.json({ok: true});
});

app.get('/api/auth/me', requireAuth, async (request, response) => {
  response.json({profile: request.currentUser});
});

app.post('/api/auth/signup', authRateLimit, async (request, response, next) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      defaultCar,
      defaultOffice,
      defaultHome,
    } = request.body;

    assertRequired(name, 'Name');
    assertRequired(email, 'Email');
    assertRequired(password, 'Password');
    assertRequired(phone, 'Phone number');

    const passwordHash = await bcrypt.hash(String(password), 12);
    const profile = await createProfile({
      name,
      email,
      passwordHash,
      phone,
      defaultCar,
      defaultOffice,
      defaultHome,
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

app.post('/api/auth/login', authRateLimit, async (request, response, next) => {
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

app.post('/api/auth/logout', (request, response, next) => {
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

app.get('/api/profiles', requireAuth, async (request, response, next) => {
  try {
    const profiles = await getProfiles(request.query.query);
    response.json({profiles});
  } catch (error) {
    next(error);
  }
});

app.get(
    '/api/admin/overview', requireAuth, requireManager,
    async (_request, response, next) => {
      try {
        const [profiles, rides] = await Promise.all([
          getProfiles(),
          listRides(),
        ]);

        response.json({profiles, rides});
      } catch (error) {
        next(error);
      }
    });

app.patch(
    '/api/profiles/:email', requireAuth, async (request, response, next) => {
      try {
        const {
          name,
          email,
          phone,
          defaultCar,
          defaultOffice,
          defaultHome,
        } = request.body;

        assertRequired(name, 'Name');
        assertRequired(email, 'Email');
        assertRequired(phone, 'Phone number');

        const profile = await updateProfile(request.currentUser.email, {
          name,
          email,
          phone,
          defaultCar,
          defaultOffice,
          defaultHome,
        });

        createUserSession(request, profile);
        logger.info('profile.updated', {
          ...requestLogContext(request),
          profileId: profile.id,
          email: profile.email,
        });
        response.json({profile});
      } catch (error) {
        next(error);
      }
    });

app.get('/api/rides', requireAuth, async (request, response, next) => {
  try {
    const rides = await listRides({
      driver: request.query.driver,
      start: request.query.start,
      end: request.query.end,
      openOnly: request.query.openOnly,
    });

    response.json({rides});
  } catch (error) {
    next(error);
  }
});

app.get('/api/rides/:rideId', requireAuth, async (request, response, next) => {
  try {
    const ride = await getRideById(request.params.rideId);

    if (!ride) {
      const error = new Error('Ride not found.');
      error.status = 404;
      throw error;
    }

    response.json({ride});
  } catch (error) {
    next(error);
  }
});

app.post(
    '/api/rides', requireAuth, ridePublishRateLimit,
    async (request, response, next) => {
      try {
        const {
          startPoint,
          endPoint,
          startWindowStart,
          startWindowEnd,
          seatsTotal,
          car,
          notes,
        } = request.body;

        assertRequired(startPoint, 'Start point');
        assertRequired(endPoint, 'End point');
        assertRequired(startWindowStart, 'Earliest departure');
        assertRequired(startWindowEnd, 'Latest departure');

        validateRideWindow(startWindowStart, startWindowEnd);

        const seatCount = Number(seatsTotal);
        if (Number.isNaN(seatCount) || seatCount < 1) {
          const error = new Error('Seats must be at least 1.');
          error.status = 400;
          throw error;
        }

        const ride = await createRide({
          driverId: request.currentUser.id,
          startPoint,
          endPoint,
          startWindowStart,
          startWindowEnd,
          seatsTotal: seatCount,
          car,
          notes,
        });

        logger.info('ride.created', {
          ...requestLogContext(request),
          rideId: ride.id,
          driverId: ride.driverId,
          startPoint: ride.startPoint,
          endPoint: ride.endPoint,
          seatsTotal: ride.seatsTotal,
        });
        response.status(201).json({ride});
      } catch (error) {
        next(error);
      }
    });

app.post(
    '/api/rides/:rideId/requests', requireAuth,
    async (request, response, next) => {
      try {
        const {message} = request.body;

        const ride = await getRideById(request.params.rideId);
        if (!ride) {
          const error = new Error('Ride not found.');
          error.status = 404;
          throw error;
        }

        if (ride.driverId === request.currentUser.id) {
          const error = new Error('Drivers cannot request their own ride.');
          error.status = 400;
          throw error;
        }

        const result = await createSeatRequest({
          rideId: request.params.rideId,
          passengerId: request.currentUser.id,
          message,
        });

        logger.info('seat_request.created', {
          ...requestLogContext(request),
          rideId: request.params.rideId,
          requestId: result.request.id,
          passengerId: request.currentUser.id,
          driverId: ride.driverId,
        });
        response.status(201).json(result);
      } catch (error) {
        next(error);
      }
    });

app.patch(
    '/api/requests/:requestId', requireAuth,
    async (request, response, next) => {
      try {
        const {decision} = request.body;
        assertRequired(decision, 'Decision');

        if (!['accepted', 'declined'].includes(String(decision))) {
          const error = new Error('Decision must be accepted or declined.');
          error.status = 400;
          throw error;
        }

        const result = await updateSeatRequest({
          requestId: request.params.requestId,
          actorId: request.currentUser.id,
          decision,
        });

        logger.info('seat_request.updated', {
          ...requestLogContext(request),
          requestId: request.params.requestId,
          actorId: request.currentUser.id,
          decision,
          rideId: result.ride.id,
        });
        response.json(result);
      } catch (error) {
        next(error);
      }
    });

app.delete(
    '/api/requests/:requestId', requireAuth,
    async (request, response, next) => {
      try {
        const result = await cancelSeatRequest({
          requestId: request.params.requestId,
          actorId: request.currentUser.id,
        });

        logger.info('seat_request.cancelled', {
          ...requestLogContext(request),
          requestId: request.params.requestId,
          actorId: request.currentUser.id,
          rideId: result.ride.id,
        });
        response.json(result);
      } catch (error) {
        next(error);
      }
    });

app.post(
    '/api/rides/:rideId/messages', requireAuth,
    async (request, response, next) => {
      try {
        const {text} = request.body;
        assertRequired(text, 'Message');

        const result = await createMessage({
          rideId: request.params.rideId,
          senderId: request.currentUser.id,
          text,
        });

        logger.info('ride.message.created', {
          ...requestLogContext(request),
          rideId: request.params.rideId,
          senderId: request.currentUser.id,
          messageId: result.message.id,
        });
        response.status(201).json(result);
      } catch (error) {
        next(error);
      }
    });

app.use(createErrorHandler({isProduction: isProduction()}));

app.listen(PORT, () => {
  logger.info('app.started', {
    port: Number(PORT),
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: logger.activeLevel,
  });
});
