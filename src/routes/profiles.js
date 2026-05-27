const express = require('express');

const logger = require('../logger');
const {requestLogContext} = require('../middleware/requestLogging');
const {
  addFavoriteLocation,
  deleteProfileAccount,
  getProfiles,
  removeFavoriteLocation,
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

router.post('/locations', async (request, response, next) => {
  try {
    const {label, address} = request.body;

    if (!String(address || '').trim()) {
      const error = new Error('Address is required.');
      error.status = 400;
      throw error;
    }

    const location = await addFavoriteLocation(
        request.currentUser.id, {label, address});

    logger.info('profile.location.added', {
      ...requestLogContext(request),
      locationId: location.id,
    });
    response.status(201).json({location});
  } catch (error) {
    next(error);
  }
});

router.delete('/locations/:locationId', async (request, response, next) => {
  try {
    await removeFavoriteLocation(
        request.currentUser.id, request.params.locationId);

    logger.info('profile.location.removed', {
      ...requestLogContext(request),
      locationId: request.params.locationId,
    });
    response.json({ok: true});
  } catch (error) {
    next(error);
  }
});

module.exports = router;
