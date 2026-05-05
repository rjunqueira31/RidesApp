const express = require('express');

const logger = require('../logger');
const {ridePublishRateLimit} = require('../middleware/rateLimit');
const {requestLogContext} = require('../middleware/requestLogging');
const {
  cancelSeatRequest,
  createMessage,
  createRide,
  createSeatRequest,
  getRideById,
  listRides,
  updateSeatRequest,
} = require('../store');

const router = express.Router();
const requestsRouter = express.Router();

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

router.get('/', async (request, response, next) => {
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

router.get('/:rideId', async (request, response, next) => {
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

router.post('/', ridePublishRateLimit, async (request, response, next) => {
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

router.post('/:rideId/requests', async (request, response, next) => {
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

requestsRouter.patch('/:requestId', async (request, response, next) => {
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

requestsRouter.delete('/:requestId', async (request, response, next) => {
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

router.post('/:rideId/messages', async (request, response, next) => {
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

module.exports = {rideRoutes: router, requestRoutes: requestsRouter};
