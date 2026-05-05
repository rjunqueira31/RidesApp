const express = require('express');

const logger = require('../logger');
const {requestLogContext} = require('../middleware/requestLogging');
const {
  deleteProfileAccount,
  getProfiles,
  updateProfile,
} = require('../store');

const router = express.Router();

function assertRequired(value, label) {
  if (!String(value || '').trim()) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }
}

function createUserSession(request, profile) {
  request.session.userId = profile.id;
  request.session.userRole = profile.role;
}

router.get('/', async (request, response, next) => {
  try {
    const profiles = await getProfiles(request.query.query);
    response.json({profiles});
  } catch (error) {
    next(error);
  }
});

router.patch('/:email', async (request, response, next) => {
  try {
    const {
      name,
      email,
      phone,
      defaultCar,
      defaultOffice,
      defaultStartingLocation,
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
      defaultStartingLocation,
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

router.delete('/', async (request, response, next) => {
  try {
    const result = await deleteProfileAccount({
      userId: request.currentUser.id,
    });

    logger.info('profile.deleted', {
      ...requestLogContext(request),
      profileId: result.profileId,
      email: result.email,
    });

    request.session.destroy((sessionError) => {
      if (sessionError) {
        next(sessionError);
        return;
      }

      response.clearCookie('connect.sid');
      response.json({ok: true});
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
