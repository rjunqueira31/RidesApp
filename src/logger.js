const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function resolveLogLevel(value) {
  const normalized = String(value || 'info').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, normalized) ? normalized :
                                                                    'info';
}

const activeLevel = resolveLogLevel(process.env.LOG_LEVEL);

function write(level, event, fields = {}) {
  if (LEVELS[level] > LEVELS[activeLevel]) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };

  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(entry)}\n`);
}

function serializeError(error) {
  if (!error) {
    return undefined;
  }

  return {
    name: error.name,
    message: error.message,
    status: error.status,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
  };
}

module.exports = {
  info(event, fields) {
    write('info', event, fields);
  },
  warn(event, fields) {
    write('warn', event, fields);
  },
  error(event, fields) {
    write('error', event, fields);
  },
  debug(event, fields) {
    write('debug', event, fields);
  },
  serializeError,
  activeLevel,
};