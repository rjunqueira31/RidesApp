const {OfficeLocation, SeatRequestStatus, UserRole} = require('@prisma/client');

const prisma = require('./db');

const EXPIRED_RIDE_RETENTION_MS = 2 * 60 * 60 * 1000;

const OFFICE_LOCATION_VALUES = new Set(Object.values(OfficeLocation));

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function toIsoString(value) {
  return value ? new Date(value).toISOString() : undefined;
}

function toStatusValue(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeOfficeLocation(value) {
  const normalizedValue = normalizeText(value).toUpperCase();
  return OFFICE_LOCATION_VALUES.has(normalizedValue) ? normalizedValue : null;
}

function getManagerEmailSet() {
  return new Set(normalizeText(process.env.MANAGER_EMAILS)
                     .split(',')
                     .map((email) => email.trim().toLowerCase())
                     .filter(Boolean));
}

function toPublicProfile(profile) {
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    defaultCar: profile.defaultCar || '',
    defaultOffice: profile.defaultOffice || '',
    defaultHome: profile.defaultHome || '',
    role: profile.role,
    createdAt: toIsoString(profile.createdAt),
    updatedAt: toIsoString(profile.updatedAt),
  };
}

function toPublicSeatRequest(request) {
  return {
    id: request.id,
    rideId: request.rideId,
    passengerId: request.passengerId,
    passengerEmail: request.passenger?.email || '',
    message: request.message || '',
    status: request.status.toLowerCase(),
    createdAt: toIsoString(request.createdAt),
    updatedAt: toIsoString(request.updatedAt),
    passenger: toPublicProfile(request.passenger),
  };
}

function toPublicMessage(message) {
  return {
    id: message.id,
    rideId: message.rideId,
    senderId: message.senderId,
    senderEmail: message.sender?.email || '',
    text: message.text,
    createdAt: toIsoString(message.createdAt),
    sender: toPublicProfile(message.sender),
  };
}

function sortByCreatedAtDesc(left, right) {
  return new Date(right.createdAt).getTime() -
      new Date(left.createdAt).getTime();
}

function sortByCreatedAtAsc(left, right) {
  return new Date(left.createdAt).getTime() -
      new Date(right.createdAt).getTime();
}

function toPublicRide(ride) {
  return {
    id: ride.id,
    driverId: ride.driverId,
    driverEmail: ride.driver?.email || '',
    startPoint: ride.startPoint,
    endPoint: ride.endPoint,
    startWindowStart: toIsoString(ride.startWindowStart),
    startWindowEnd: toIsoString(ride.startWindowEnd),
    seatsTotal: ride.seatsTotal,
    seatsLeft: ride.seatsLeft,
    car: ride.car || '',
    notes: ride.notes || '',
    createdAt: toIsoString(ride.createdAt),
    driver: toPublicProfile(ride.driver),
    requests: [...(ride.requests || [])]
                  .sort(sortByCreatedAtDesc)
                  .map((request) => toPublicSeatRequest(request)),
    messages: [...(ride.messages || [])]
                  .sort(sortByCreatedAtAsc)
                  .map((message) => toPublicMessage(message)),
  };
}

function rideInclude() {
  return {
    driver: true,
    requests: {
      include: {
        passenger: true,
      },
    },
    messages: {
      include: {
        sender: true,
      },
    },
  };
}

async function purgeExpiredRides() {
  const cutoff = new Date(Date.now() - EXPIRED_RIDE_RETENTION_MS);

  await prisma.ride.deleteMany({
    where: {
      startWindowEnd: {
        lt: cutoff,
      },
    },
  });
}

async function getUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  return prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
  });
}

async function getUserById(userId) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) {
    return null;
  }

  return prisma.user.findUnique({
    where: {
      id: normalizedUserId,
    },
  });
}

async function resolveUser({email, userId}) {
  if (userId) {
    return getUserById(userId);
  }

  return getUserByEmail(email);
}

async function getProfiles(searchQuery) {
  const query = normalizeText(searchQuery);
  const where = query ? {
    OR: [
      {
        name: {
          contains: query,
          mode: 'insensitive',
        },
      },
      {
        email: {
          contains: query.toLowerCase(),
          mode: 'insensitive',
        },
      },
    ],
  } :
                        {};

  const profiles = await prisma.user.findMany({
    where,
    orderBy: {
      name: 'asc',
    },
  });

  return profiles.map((profile) => toPublicProfile(profile));
}

async function getProfileById(userId) {
  const profile = await getUserById(userId);
  return toPublicProfile(profile);
}

async function getAuthUserByEmail(email) {
  return getUserByEmail(email);
}

async function createProfile(profileInput) {
  const email = normalizeEmail(profileInput.email);
  const existing = await getUserByEmail(email);

  if (existing) {
    throw new Error('A profile with this email already exists.');
  }

  if (!normalizeText(profileInput.passwordHash)) {
    throw new Error('Password hash is required.');
  }

  const profile = await prisma.user.create({
    data: {
      name: normalizeText(profileInput.name),
      email,
      passwordHash: normalizeText(profileInput.passwordHash),
      phone: normalizeText(profileInput.phone),
      defaultCar: normalizeText(profileInput.defaultCar) || null,
      defaultOffice: normalizeOfficeLocation(profileInput.defaultOffice),
      defaultHome: normalizeText(profileInput.defaultHome) || null,
      role: getManagerEmailSet().has(email) ? UserRole.MANAGER_USER :
                                              UserRole.DEFAULT_USER,
    },
  });

  return toPublicProfile(profile);
}

async function updateProfile(currentEmail, profileInput) {
  const normalizedCurrentEmail = normalizeEmail(currentEmail);
  const existing = await getUserByEmail(normalizedCurrentEmail);

  if (!existing) {
    throw new Error('Profile not found.');
  }

  const nextEmail = normalizeEmail(profileInput.email);
  const emailOwner = await getUserByEmail(nextEmail);

  if (emailOwner && emailOwner.id !== existing.id) {
    throw new Error('Another profile is already using this email.');
  }

  const updatedProfile = await prisma.user.update({
    where: {
      id: existing.id,
    },
    data: {
      name: normalizeText(profileInput.name),
      email: nextEmail,
      phone: normalizeText(profileInput.phone),
      defaultCar: normalizeText(profileInput.defaultCar) || null,
      defaultOffice: normalizeOfficeLocation(profileInput.defaultOffice),
      defaultHome: normalizeText(profileInput.defaultHome) || null,
      role: getManagerEmailSet().has(nextEmail) ? UserRole.MANAGER_USER :
                                                  UserRole.DEFAULT_USER,
    },
  });

  return toPublicProfile(updatedProfile);
}

async function listRides(filters = {}) {
  await purgeExpiredRides();

  const driverFilter = normalizeText(filters.driver);
  const startFilter = normalizeText(filters.start);
  const endFilter = normalizeText(filters.end);
  const seatFilter = normalizeText(filters.openOnly);
  const where = {};

  if (driverFilter) {
    where.OR = [
      {
        driver: {
          name: {
            contains: driverFilter,
            mode: 'insensitive',
          },
        },
      },
      {
        driver: {
          email: {
            contains: driverFilter.toLowerCase(),
            mode: 'insensitive',
          },
        },
      },
    ];
  }

  if (startFilter) {
    where.startPoint = {
      contains: startFilter,
      mode: 'insensitive',
    };
  }

  if (endFilter) {
    where.endPoint = {
      contains: endFilter,
      mode: 'insensitive',
    };
  }

  if (seatFilter === 'true') {
    where.seatsLeft = {
      gt: 0,
    };
  }

  const rides = await prisma.ride.findMany({
    where,
    include: rideInclude(),
    orderBy: {
      startWindowStart: 'asc',
    },
  });

  return rides.map((ride) => toPublicRide(ride));
}

async function getRideById(rideId) {
  await purgeExpiredRides();

  const ride = await prisma.ride.findUnique({
    where: {
      id: normalizeText(rideId),
    },
    include: rideInclude(),
  });

  if (!ride) {
    return null;
  }

  return toPublicRide(ride);
}

async function createRide(rideInput) {
  await purgeExpiredRides();

  const driver = await resolveUser({
    email: rideInput.driverEmail,
    userId: rideInput.driverId,
  });

  if (!driver) {
    throw new Error('Profile not found.');
  }

  const ride = await prisma.ride.create({
    data: {
      driverId: driver.id,
      startPoint: normalizeText(rideInput.startPoint),
      endPoint: normalizeText(rideInput.endPoint),
      startWindowStart: new Date(rideInput.startWindowStart),
      startWindowEnd: new Date(rideInput.startWindowEnd),
      seatsTotal: Number(rideInput.seatsTotal),
      seatsLeft: Number(rideInput.seatsTotal),
      car: normalizeText(rideInput.car) || null,
      notes: normalizeText(rideInput.notes) || null,
    },
    include: rideInclude(),
  });

  return toPublicRide(ride);
}

async function createSeatRequest(
    {rideId, passengerEmail, passengerId, message}) {
  await purgeExpiredRides();

  const ride = await prisma.ride.findUnique({
    where: {
      id: normalizeText(rideId),
    },
  });

  if (!ride) {
    throw new Error('Ride not found.');
  }

  if (ride.seatsLeft <= 0) {
    throw new Error('This ride is already full.');
  }

  const passenger = await resolveUser({
    email: passengerEmail,
    userId: passengerId,
  });

  if (!passenger) {
    throw new Error('Profile not found.');
  }

  const duplicateRequest = await prisma.seatRequest.findFirst({
    where: {
      rideId: ride.id,
      passengerId: passenger.id,
      status: {
        not: SeatRequestStatus.DECLINED,
      },
    },
  });

  if (duplicateRequest) {
    throw new Error('You already have an active request for this ride.');
  }

  const request = await prisma.seatRequest.create({
    data: {
      rideId: ride.id,
      passengerId: passenger.id,
      message: normalizeText(message) || null,
    },
    include: {
      passenger: true,
    },
  });

  return {
    request: toPublicSeatRequest(request),
    ride: await getRideById(ride.id),
  };
}

async function updateSeatRequest({requestId, actorEmail, actorId, decision}) {
  await purgeExpiredRides();

  const request = await prisma.seatRequest.findUnique({
    where: {
      id: normalizeText(requestId),
    },
    include: {
      passenger: true,
      ride: true,
    },
  });

  if (!request) {
    throw new Error('Seat request not found.');
  }

  const actor = await resolveUser({
    email: actorEmail,
    userId: actorId,
  });

  if (!actor || request.ride.driverId !== actor.id) {
    throw new Error('Only the driver can manage passenger requests.');
  }

  if (request.status !== SeatRequestStatus.PENDING) {
    throw new Error('This request has already been processed.');
  }

  const nextStatus = toStatusValue(decision);
  let updatedRequest;

  if (nextStatus === SeatRequestStatus.ACCEPTED) {
    if (request.ride.seatsLeft <= 0) {
      throw new Error('No seats left on this ride.');
    }

    const [, seatRequest] = await prisma.$transaction([
      prisma.ride.update({
        where: {
          id: request.rideId,
        },
        data: {
          seatsLeft: {
            decrement: 1,
          },
        },
      }),
      prisma.seatRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: SeatRequestStatus.ACCEPTED,
        },
        include: {
          passenger: true,
        },
      }),
    ]);

    updatedRequest = seatRequest;
  } else if (nextStatus === SeatRequestStatus.DECLINED) {
    updatedRequest = await prisma.seatRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: SeatRequestStatus.DECLINED,
      },
      include: {
        passenger: true,
      },
    });
  } else {
    throw new Error('Decision must be accepted or declined.');
  }

  return {
    request: toPublicSeatRequest(updatedRequest),
    ride: await getRideById(request.rideId),
  };
}

async function cancelSeatRequest({requestId, actorEmail, actorId}) {
  await purgeExpiredRides();

  const request = await prisma.seatRequest.findUnique({
    where: {
      id: normalizeText(requestId),
    },
    include: {
      ride: true,
      passenger: true,
    },
  });

  if (!request) {
    throw new Error('Seat request not found.');
  }

  const actor = await resolveUser({
    email: actorEmail,
    userId: actorId,
  });

  const isPassenger = actor && request.passengerId === actor.id;
  const isDriver = actor && request.ride.driverId === actor.id;

  if (!isPassenger && !isDriver) {
    throw new Error(
        'Only the passenger or driver can remove this ride request.');
  }

  if (![SeatRequestStatus.PENDING, SeatRequestStatus.ACCEPTED].includes(
          request.status)) {
    throw new Error('This ride request is no longer active.');
  }

  if (request.status === SeatRequestStatus.ACCEPTED) {
    await prisma.$transaction([
      prisma.ride.update({
        where: {
          id: request.rideId,
        },
        data: {
          seatsLeft: {
            increment: 1,
          },
        },
      }),
      prisma.seatRequest.delete({
        where: {
          id: request.id,
        },
      }),
    ]);
  } else {
    await prisma.seatRequest.delete({
      where: {
        id: request.id,
      },
    });
  }

  return {
    ride: await getRideById(request.rideId),
  };
}

async function createMessage({rideId, senderEmail, senderId, text}) {
  await purgeExpiredRides();

  const ride = await prisma.ride.findUnique({
    where: {
      id: normalizeText(rideId),
    },
  });

  if (!ride) {
    throw new Error('Ride not found.');
  }

  const sender = await resolveUser({
    email: senderEmail,
    userId: senderId,
  });

  if (!sender) {
    throw new Error('Profile not found.');
  }

  const message = await prisma.message.create({
    data: {
      rideId: ride.id,
      senderId: sender.id,
      text: normalizeText(text),
    },
    include: {
      sender: true,
    },
  });

  return {
    message: toPublicMessage(message),
    ride: await getRideById(ride.id),
  };
}

module.exports = {
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
};
