const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const {requestLogContext} = require('./requestLogging');

function createRateLimitHandler(message) {
  return (request, response, _next, options) => {
    logger.warn('http.rate_limit.exceeded', {
      ...requestLogContext(request),
      status: options.statusCode,
      limit: options.limit,
      windowMs: options.windowMs,
    });

    response.status(options.statusCode).json({error: message});
  };
}

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler(
      'Too many authentication attempts. Please try again later.'),
});

const ridePublishRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler(
      'Too many ride publish attempts. Please try again later.'),
});

module.exports = {
  authRateLimit,
  ridePublishRateLimit,
};